const commands = new Set(['setup','check-credentials','forget-credentials','update','uninstall','version','help']);
const commandHelp = [
    ['setup', 'First-time setup: consent to the Chrome download (cached download reused), then optional saved login; no browser or answers'],
    ['setup --browser-only', 'Install-time step for OS installers: download the pinned browser with no prompts and no login step'],
    ['check-credentials', 'Check the saved login without displaying it'],
    ['forget-credentials', 'Remove the saved login'],
    ['accuracy <on|off>', 'Set accuracy for this invocation only (on = 70-90% band, randomized per run)'],
    ['accuracy [status]', 'Show the resolved accuracy configuration without launching'],
    ['update', 'Check published stable releases and confirm a verified replacement'],
    ['uninstall', 'Confirm, then remove app data, the saved login and the program itself; retain live or uncertain data'],
    ['version', 'Print the version'],
    ['help', 'Show this help'],
];
const optionHelp = [
    ['-h, --help', 'Show this help'],
    ['-v, --version', 'Print the version'],
    ['-a, --accuracy <on|off>', 'Enable the 70-90% first-try accuracy band (on) or force perfect (off)'],
    ['-p, --perfect, --no-mistakes', 'Force perfect answers (100% accuracy; the default)'],
];
const interactiveHelp = [
    ['start', 'Start answering (can submit live answers)'],
    ['stop', 'Stop answering'],
    ['status', 'Show current status (including accuracy target)'],
    ['mode auto', 'Answer and submit automatically (default)'],
    ['mode semi', 'Change live answers but wait for manual submission'],
    ['accuracy', 'Show accuracy config, per-run target and first-try stats'],
    ['accuracy <on|off>', 'Set accuracy when stopped (on = 70-90% band, randomized per run; perfect is the provisional Dash recommendation)'],
    ['delay', 'Show the human-paced wait before each submission (off by default; delay on enables per-type waits of 2-15s and delay off is the provisional Dash recommendation)'],
    ['delay off', 'Restore super speed: no wait between answers'],
    ['delay on', 'Enable the human-paced wait (per-question-type ranges)'],
    ['refresh', 'Reload the task word lists'],
    ['inspect-self-mark', 'Read-only inspection of a self-mark page'],
    ['inspect-dash', 'Read-only inspection of a Dash round (for shapes the answerer refuses)'],
    ['inspect-assessment', 'Read-only capture of an Assessment page: short summary line plus one full JSON file in ./assessment-captures (answering stays disabled)'],
    ['watch-assessment [on|off]', 'Passive read-only watch: writes a new Assessment capture file whenever the page changes (never answers)'],
    ['inspect-components', 'Read-only inspection of a slide\'s question components (for slides the answerer refuses)'],
    ['quit, exit', 'Close the CLI'],
];
function formatRows(rows) {
    const width = Math.max(...rows.map(([name]) => name.length));
    return rows.map(([name, text]) => '  ' + name.padEnd(width) + '  ' + text + '\n').join('');
}
function parseCommand(args) {
    if (!args.length) return {command:'run'};
    // Global help/version win over accuracy flags.
    if (args.includes('-h') || args.includes('--help')) return {command:'help'};
    if (args.includes('-v') || args.includes('--version')) return {command:'version'};
    // Legacy helpful error: '--setup' etc. must be written without dashes.
    if (args.length === 1 && args[0].startsWith('--') && commands.has(args[0].slice(2))) return {error:`Use ${args[0].slice(2)} instead of ${args[0]}.`};
    let rest = args.slice();
    // Explicit `run` subcommand is accepted with accuracy flags only. A bare
    // token after it is rejected, so `run uninstall`, `run update` and friends
    // can never dispatch maintenance commands; unknown flags fail below.
    if (rest[0] === 'run') {
        rest = rest.slice(1);
        if (rest.length && !rest[0].startsWith('-')) return {error:'Use one subcommand. See help.'};
    }
    else if (rest[0] === 'accuracy') {
        // Top-level accuracy subcommand (issue #229): one operand with the same
        // meaning as the interactive command, applied to this invocation only
        // (nothing is persisted). `accuracy` alone, or `accuracy status`, is a
        // read-only report of the resolved configuration and never launches.
        // Kept out of the `commands` set on purpose: `--accuracy` is a flag.
        const operand = rest.slice(1).join(' ').trim().toLowerCase();
        if (operand === '' || operand === 'status') return {command:'accuracy-status'};
        if (['off','perfect','no-mistakes','no-mistake'].includes(operand)) return {command:'run', accuracy:{perfect:true}};
        if (['on','default','auto'].includes(operand)) return {command:'run', accuracy:{on:true}};
        return {error:'Usage: accuracy [on|off|status] (on = 70-90% band, randomized per run).'};
    }
    else if (rest[0] && !rest[0].startsWith('-')) {
        // Install-time variant: the OS installer already presented the download
        // notice, so this downloads the pinned browser with no prompts.
        if (rest[0] === 'setup' && rest.length === 2 && rest[1] === '--browser-only') return {command:'setup', browserOnly:true};
        // A leading subcommand (setup, etc.) keeps the strict single-arg rule.
        if (rest.length !== 1) return {error:'Use one subcommand. See help.'};
        const value = rest[0];
        if (commands.has(value)) return {command:value};
        return {error:'Unknown command. See help.'};
    }
    try {
        const { parseAccuracyCliArgs } = require('./accuracy');
        const { options, error } = parseAccuracyCliArgs(rest);
        if (error) return {error};
        const accuracy = {};
        if (options.on) accuracy.on = true;
        if (options.perfect) accuracy.perfect = true;
        return {command:'run', accuracy};
    } catch (e) {
        return {error: e.message};
    }
}
// Read-only report of the accuracy configuration this invocation resolves
// from defaults and env (no CLI flags, no run). Throws on invalid env, like
// startup would.
function accuracyStatusText(env = process.env) {
    const { resolveAccuracyConfig } = require('./accuracy');
    const config = resolveAccuracyConfig({ cli: {}, env, config: env.EP_TEST_BOOT === '1' ? undefined : require('./app-config').readConfig().accuracy });
    if (!config.enabled) return `Accuracy: perfect (100%), no intentional mistakes (source: ${config.source}).`;
    return `Accuracy: on, band ${config.min}-${config.max}%, target randomized per run (source: ${config.source}). Applies to each new run; the interactive accuracy command overrides it.`;
}
function helpText() {
    return 'EducationPerfected ' + require('../package.json').version + '\n\n'
      + 'Usage:\n  educationperfected [run] [--accuracy on|off|--perfect]\n  educationperfected accuracy <on|off|status>\n  educationperfected <command>\n\n'
      + 'With no command, opens the login browser and interactive CLI; no answers until start.\n'
      + 'Random accuracy is OFF by default: no intentional mistakes are added. Turn it on with\n'
      + '`accuracy on` (70-90% band, randomized per run); the run then\n'
      + 'occasionally submits a small human-like mistake (typo / neighboring choice)\n'
      + 'before the normal retry/advance path completes the run. On Dash each\n'
      + 'mistake is expected (unproved live) to burn sprint time/points, so perfect stays the\n'
      + 'provisional Dash recommendation.\n'
      + 'Env overrides: EP_ACCURACY=on|off; EP_PERFECT=0 enables the 70-90% band, EP_PERFECT=1 forces perfect.\n'
      + 'Answer pacing is OFF by default (super speed): `delay on` or EP_HUMAN_DELAY=on\n'
      + 'enables a short per-question-type wait before each submission.\n\n'
      + 'Commands:\n' + formatRows(commandHelp) + '\n'
      + 'Options:\n' + formatRows(optionHelp) + '\n'
      + 'Interactive commands (in the running CLI):\n' + formatRows(interactiveHelp) + '\n'
      + 'Assessments are always refused; inspect-assessment is a read-only capture only.\n';
}
module.exports={parseCommand,helpText,accuracyStatusText};
