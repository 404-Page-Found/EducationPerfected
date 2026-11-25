#!/usr/bin/env node
const readline = require('node:readline');
const { launchProgram, promptCredentials } = require('../index');
const { diagnostic } = require('../lib/diagnostics');

async function runCli({ input = process.stdin, output = process.stdout, launch = launchProgram, onBrowserClosed = () => {}, accuracy = {} } = {}) {
    output.write('Opening EducationPerfected. Finish sign-in in the browser.\n');
    let terminal = null, controls = null, pendingApproval = null, quitPromise = null;
    const quit = () => {
        if (pendingApproval) { pendingApproval.resolve(false); pendingApproval = null; }
        if (!quitPromise && controls) quitPromise = controls.close().then(() => terminal.close()).catch(error => { quitPromise = null; throw error; });
        return quitPromise || Promise.resolve();
    };
    // A manually closed browser ends the session: drain controls and exit instead of idling.
    const browserGone = () => {
        if (quitPromise || !terminal) return;
        output.write('Browser closed; exiting.\n');
        quit().catch(error => output.write(diagnostic(error, 'Shutdown') + '\n'));
    };
    const requestReflectionText = (approval, onCancel) => new Promise(resolve => {
        if (!terminal || pendingApproval || quitPromise) { resolve(false); return; }
        let unregisterCancel = null;
        const request = { approval, label: 'Reflection fill', phase: 'text', text: null, resolve: null };
        const finish = value => {
            unregisterCancel?.();
            unregisterCancel = null;
            if (pendingApproval === request) pendingApproval = null;
            resolve(value);
        };
        request.resolve = finish;
        pendingApproval = request;
        unregisterCancel = typeof onCancel === 'function' ? onCancel(() => {
            if (pendingApproval !== request) return;
            output.write('Reflection fill cancelled; no further input.\n');
            finish(false);
        }) : null;
        output.write(`Reflection text required for ${approval.key}. Read the visible question and enter your own single-line response (1-2000 characters). Nothing is typed until you confirm. stop or quit cancels.\n`);
    });
    const recorder = require('../lib/assessment-diagnostics').pageRecorder();
    controls = recorder.attach(await launch({ onBrowserClosed, onBrowserDisconnected: browserGone, reflectionTextProvider: requestReflectionText, accuracy, selectPage: recorder.selectPage }));
    terminal = readline.createInterface({ input, output, terminal: Boolean(input.isTTY && output.isTTY) });
    output.write('Commands: start, stop, status, mode auto, mode semi, accuracy [on|off], delay, delay on, delay off, refresh, inspect-self-mark, inspect-dash, inspect-components, inspect-assessment, watch-assessment, quit\n');
    const print = () => output.write(JSON.stringify(controls.status()) + '\n');
    require('../lib/assessment-diagnostics').armWatchFromEnv(controls, process.env, output);
    const onSignal = () => { quit().catch(error => output.write(diagnostic(error, 'Shutdown') + '\n')); };
    terminal.on('SIGINT', onSignal);
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    process.on('SIGHUP', onSignal);
    print();
    try {
        for await (const line of terminal) {
            const command = line.trim();
            if (pendingApproval) {
                const request = pendingApproval;
                if (request.phase === 'text' && !['quit', 'exit', 'stop'].includes(command)) {
                    if (!require('../lib/reflection-handler').validReflectionText(line)) {
                        request.resolve(false);
                        output.write('Reflection text not supported; no input.\n');
                        continue;
                    }
                    request.text = line;
                    request.phase = 'confirm';
                    output.write(`Reflection fill approval for ${request.approval.key}: ${JSON.stringify(line)}. Type yes to fill this response only. No Submit or self-grade will be clicked. Anything else cancels.\n`);
                    continue;
                }
                if (request.phase) {
                    const approved = request.phase === 'confirm' && command === 'yes';
                    request.resolve(approved ? request.text : false);
                    output.write(approved ? 'Reflection fill approved for this question only.\n' : 'Reflection fill not approved; no input.\n');
                    if (command === 'quit' || command === 'exit') { await quit(); print(); break; }
                    continue;
                }
            }
            try {
                if (command === 'start') controls.start();
                else if (command === 'stop') await controls.stop();
                else if (command === 'status' || command === '') { /* print below */ }
                else if (command === 'mode auto' || command === 'mode semi') await controls.mode(command.slice(5));
                else if (command === 'accuracy' || command.startsWith('accuracy ')) {
                    const arg = command === 'accuracy' ? '' : command.slice('accuracy '.length);
                    if (typeof controls.setAccuracy === 'function') {
                        // Show setAccuracy's own validation message (e.g. "Accuracy must be
                        // 0-100.") rather than the generic command-failure fallback.
                        try { await controls.setAccuracy(arg); }
                        catch (e) { output.write(String(e && e.message ? e.message : e) + '\n'); continue; }
                    }
                    else output.write('Accuracy control unavailable in this session.\n');
                }
                else if (command === 'delay' || command.startsWith('delay ')) {
                    const pacing = controls.delay(command === 'delay' ? undefined : command.slice(6).trim());
                    output.write((pacing.error ? pacing.error : 'Answer pacing: ' + pacing.delay) + '\n');
                }
                else if (command === 'inspect-self-mark') output.write('EP_SELF_MARK_INSPECT ' + JSON.stringify(await controls.inspect()) + '\n');
                else if (command === 'inspect-dash') output.write('EP_DASH_INSPECT ' + JSON.stringify(await controls.inspectDash()) + '\n');
                else if (command === 'inspect-components') output.write('EP_COMPONENTS_INSPECT ' + JSON.stringify(await controls.inspectComponents()) + '\n');
                else if (command === 'inspect-assessment') output.write('EP_ASSESSMENT_INSPECT ' + JSON.stringify(await controls.inspectAssessment()) + '\n');
                else if (command === 'watch-assessment' || command.startsWith('watch-assessment ')) {
                    if (!require('../lib/assessment-diagnostics').runWatchCommand(controls, command.slice(16), output)) continue;
                }
                else if (command === 'refresh') await controls.refresh();
                else if (command === 'quit' || command === 'exit') { await quit(); print(); break; }
                else { output.write('Unknown command. Use start, stop, status, mode auto, mode semi, accuracy [on|off], delay, delay on, delay off, refresh, inspect-self-mark, inspect-dash, inspect-components, inspect-assessment, watch-assessment or quit.\n'); continue; }
                print();
            } catch {
                output.write(command === 'inspect-self-mark' || command === 'inspect-dash' || command === 'inspect-components' || command === 'inspect-assessment'
                    ? 'Inspection unavailable. Stop answering and wait for pending controls before read-only inspection.\n'
                    : 'Command failed. Stop the run before mode or word-list changes; inspect the browser if a control failed.\n');
            }
        }
    } finally {
        try { await quit(); } finally {
            process.removeListener('SIGINT', onSignal);
            process.removeListener('SIGTERM', onSignal);
            process.removeListener('SIGHUP', onSignal);
        }
    }
}
async function credentialCommand(command, { store, prompt = promptCredentials, output = process.stdout } = {}) {
    store ||= require('../lib/credential-store').createCredentialStore();
    if (command === '--check-credentials') {
        const record = await store.read();
        output.write(record ? 'Saved login is available and its record is valid.\n' : 'No saved login was found.\n');
        return;
    }
    if (command === '--forget-credentials') {
        const removed = await store.remove();
        output.write(removed ? 'Saved login removed from the OS credential store.\n' : 'No saved login was found.\n');
        return;
    }
    output.write('Save a login in your OS credential store; nothing is saved in this folder.\n');
    // Setup has no browser signal owner. Restore raw input even on SIGTERM.
    const interrupted = signal => {
        if (process.stdin.isTTY && process.stdin.isRaw) process.stdin.setRawMode(false);
        process.exit(signal === 'SIGINT' ? 130 : signal === 'SIGHUP' ? 129 : 143);
    };
    const onInt = () => interrupted('SIGINT'), onTerm = () => interrupted('SIGTERM'), onHup = () => interrupted('SIGHUP');
    let record;
    process.on('SIGINT', onInt); process.on('SIGTERM', onTerm); process.on('SIGHUP', onHup);
    try { record = await prompt(undefined, { setup: true }); } finally {
        process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm); process.removeListener('SIGHUP', onHup);
    }
    if (!record) { output.write('Setup cancelled; no login saved.\n'); return; }
    await store.save(record);
    output.write('Login saved in the OS credential store. Run the CLI to sign in.\n');
}
module.exports = { runCli, credentialCommand };
if (require.main === module) {
    const {parseCommand,helpText}=require('../lib/cli-command');
    const parsed=parseCommand(process.argv.slice(2));
    if(parsed.error){console.error(parsed.error);process.exitCode=1;}
    else if(parsed.command==='help')console.log(helpText());
    else if(parsed.command==='version')console.log(require('../package.json').version);
    else if(parsed.command==='accuracy-status'){
        try { console.log(require('../lib/cli-command').accuracyStatusText(process.env)); }
        catch (error) { console.error(String(error && error.message ? error.message : error)); process.exitCode=1; }
    }
    else if(['setup','check-credentials','forget-credentials'].includes(parsed.command)){
        (async()=>{
            if(parsed.command==='setup'){
                if(parsed.browserOnly){
                    // Install-time variant: the OS installer presented the
                    // notice, so consent is implied and no login prompt runs.
                    console.log(require('../packaging/download-browser').downloadNotice());
                    await require('../packaging/download-browser').ensureBrowser({consent:async()=>true});
                    console.log('Browser ready. Save a login from the app, or run: educationperfected setup');
                    return;
                }
                await require('../packaging/download-browser').ensureBrowser();
                console.log('Browser ready. Saving a login is optional; leave email empty to skip.');
            }
            await credentialCommand('--'+parsed.command);
        })().catch(()=>{console.error('Setup/credential command failed; no plaintext fallback.');process.exitCode=1;});
    }else if(parsed.command==='run')runCli({accuracy: parsed.accuracy || {}}).catch(error=>{console.error(diagnostic(error,'EducationPerfected CLI'));process.exitCode=1;});
    else {console.error('This command is available in the packaged app only.');process.exitCode=1;}
}
