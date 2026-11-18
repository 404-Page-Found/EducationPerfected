const commands = new Set(['setup','check-credentials','forget-credentials','update','uninstall','version','help']);
const commandHelp = [
    ['setup', 'First-time setup: consent to the Chrome download (cached download reused), then optional saved login; no browser or answers'],
    ['check-credentials', 'Check the saved login without displaying it'],
    ['forget-credentials', 'Remove the saved login'],
    ['update', 'Check published stable releases and confirm a verified replacement'],
    ['uninstall', 'Confirm, then remove app data, the saved login and the program itself; retain live or uncertain data'],
    ['version', 'Print the version'],
    ['help', 'Show this help'],
];
const optionHelp = [
    ['-h, --help', 'Show this help'],
    ['-v, --version', 'Print the version'],
    ['--accuracy <n>', 'Fixed first-try accuracy target 0-100 (e.g. --accuracy 82)'],
    ['--accuracy-range <min-max>', 'Accuracy band, randomized per run (default 70-90)'],
    ['--perfect, --no-mistakes', 'Disable intentional mistakes (100% accuracy)'],
];
const interactiveHelp = [
    ['start', 'Start answering (can submit live answers)'],
    ['stop', 'Stop answering'],
    ['status', 'Show current status (including accuracy target)'],
    ['mode auto', 'Answer and submit automatically (default)'],
    ['mode semi', 'Change live answers but wait for manual submission'],
    ['accuracy', 'Show accuracy config, per-run target and first-try stats'],
    ['accuracy <n|min-max|off|on>', 'Set accuracy when stopped (e.g. accuracy 82, accuracy 70-90, accuracy off)'],
    ['delay', 'Show the human-paced wait before each submission (on by default: 2-15s by question type)'],
    ['delay off', 'Restore super speed: no wait between answers'],
    ['delay MIN-MAX', 'Override the wait range in seconds, e.g. delay 2-6; delay reset restores per-type ranges'],
    ['refresh', 'Reload the task word lists'],
    ['inspect-self-mark', 'Read-only inspection of a self-mark page'],
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
    // Explicit `run` subcommand is accepted with optional accuracy flags.
    if (rest[0] === 'run') rest = rest.slice(1);
    else if (rest[0] && !rest[0].startsWith('-')) {
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
        if (options.fixedTarget !== undefined) accuracy.fixedTarget = options.fixedTarget;
        if (options.min !== undefined) { accuracy.min = options.min; accuracy.max = options.max; }
        if (options.perfect) accuracy.perfect = true;
        return {command:'run', accuracy};
    } catch (e) {
        return {error: e.message};
    }
}
function helpText() {
    return 'EducationPerfected ' + require('../package.json').version + '\n\n'
      + 'Usage:\n  educationperfected [run] [accuracy options]\n  educationperfected <command>\n\n'
      + 'With no command, opens the login browser and interactive CLI; no answers until start.\n'
      + 'Random accuracy is ON by default: each run picks a first-try target in 70-90%\n'
      + 'and occasionally submits a small human-like mistake (typo / neighboring\n'
      + 'choice) before the normal retry/advance path completes the run.\n'
      + 'Env overrides: EP_ACCURACY=82, EP_ACCURACY_RANGE=70-90, EP_PERFECT=1.\n\n'
      + 'Commands:\n' + formatRows(commandHelp) + '\n'
      + 'Options:\n' + formatRows(optionHelp) + '\n'
      + 'Interactive commands (in the running CLI):\n' + formatRows(interactiveHelp) + '\n'
      + 'Assessments are always refused.\n';
}
module.exports={parseCommand,helpText};
