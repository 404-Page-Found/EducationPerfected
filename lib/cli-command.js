const commands = new Set(['setup','check-credentials','forget-credentials','update','uninstall','version','help']);
const commandHelp = [
    ['setup', 'First-time setup: consent to the Chrome download (cached download reused), then optional saved login; no browser or answers'],
    ['check-credentials', 'Check the saved login without displaying it'],
    ['forget-credentials', 'Remove the saved login'],
    ['accuracy <n|min-max|off|on>', 'Set accuracy for this invocation only (same meaning as the run flags)'],
    ['accuracy [status]', 'Show the resolved accuracy configuration without launching'],
    ['update', 'Check published stable releases and confirm a verified replacement'],
    ['uninstall', 'Confirm, then remove app data, the saved login and the program itself; retain live or uncertain data'],
    ['version', 'Print the version'],
    ['help', 'Show this help'],
];
const optionHelp = [
    ['-h, --help', 'Show this help'],
    ['-v, --version', 'Print the version'],
    ['-a, --accuracy <n>', 'Fixed first-try accuracy target 0-100 (e.g. -a 82)'],
    ['-r, --accuracy-range <min-max>', 'Accuracy band, randomized per run (e.g. -r 70-90)'],
    ['-p, --perfect, --no-mistakes', 'Disable intentional mistakes (100% accuracy; the default)'],
];
const interactiveHelp = [
    ['start', 'Start answering (can submit live answers)'],
    ['stop', 'Stop answering'],
    ['status', 'Show current status (including accuracy target)'],
    ['mode auto', 'Answer and submit automatically (default)'],
    ['mode semi', 'Change live answers but wait for manual submission'],
    ['accuracy', 'Show accuracy config, per-run target and first-try stats'],
    ['accuracy <n|min-max|off|on>', 'Set accuracy when stopped (e.g. accuracy 82, accuracy 70-90, accuracy off)'],
    ['delay', 'Show the human-paced wait before each submission (on by default: 2-15s by question type; Dash shares text 2-6s, delay off for max Dash score)'],
    ['delay off', 'Restore super speed: no wait between answers (recommended for timed Dash sprints)'],
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
    else if (rest[0] === 'accuracy') {
        // Top-level accuracy subcommand (issue #229): one operand with the same
        // meaning as the interactive command, applied to this invocation only
        // (nothing is persisted). `accuracy` alone, or `accuracy status`, is a
        // read-only report of the resolved configuration and never launches.
        // Kept out of the `commands` set on purpose: `--accuracy` is a flag.
        const operand = rest.slice(1).join(' ').trim().toLowerCase();
        if (operand === '' || operand === 'status') return {command:'accuracy-status'};
        const { DEFAULT_MIN, DEFAULT_MAX, parseAccuracyValue, parseAccuracyRange } = require('./accuracy');
        if (['off','perfect','no-mistakes','no-mistake','100'].includes(operand)) return {command:'run', accuracy:{perfect:true}};
        if (['on','default','auto'].includes(operand)) return {command:'run', accuracy:{min:DEFAULT_MIN, max:DEFAULT_MAX}};
        const range = parseAccuracyRange(operand);
        if (range) return {command:'run', accuracy:{min:range.min, max:range.max}};
        const value = parseAccuracyValue(operand);
        if (value !== null) return {command:'run', accuracy:{fixedTarget:value}};
        return {error:'Usage: accuracy [n|min-max|off|on|status] (e.g. accuracy 82, accuracy 70-90, accuracy off).'};
    }
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
// Read-only report of the accuracy configuration this invocation resolves
// from defaults and env (no CLI flags, no run). Throws on invalid env, like
// startup would.
function accuracyStatusText(env = process.env) {
    const { resolveAccuracyConfig } = require('./accuracy');
    const config = resolveAccuracyConfig({ cli: {}, env });
    if (!config.enabled) return `Accuracy: perfect (100%), no intentional mistakes (source: ${config.source}).`;
    const shape = config.fixedTarget !== null && config.fixedTarget !== undefined
        ? `fixed target ${config.fixedTarget}%`
        : `band ${config.min}-${config.max}%, target randomized per run`;
    return `Accuracy: enabled, ${shape} (source: ${config.source}). Applies to each new run; run flags and the interactive accuracy command override it.`;
}
function helpText() {
    return 'EducationPerfected ' + require('../package.json').version + '\n\n'
      + 'Usage:\n  educationperfected [run] [accuracy options]\n  educationperfected accuracy <n|min-max|off|on|status>\n  educationperfected <command>\n\n'
      + 'With no command, opens the login browser and interactive CLI; no answers until start.\n'
      + 'Random accuracy is OFF by default: runs answer perfectly. Turn it on with\n'
      + '`accuracy on` (70-90% band), `accuracy 82` or the flags below; the run then\n'
      + 'occasionally submits a small human-like mistake (typo / neighboring choice)\n'
      + 'before the normal retry/advance path completes the run.\n'
      + 'Env overrides: EP_ACCURACY=82, EP_ACCURACY_RANGE=70-90, EP_PERFECT=0 enables\n'
      + 'the default band, EP_PERFECT=1 forces perfect.\n\n'
      + 'Commands:\n' + formatRows(commandHelp) + '\n'
      + 'Options:\n' + formatRows(optionHelp) + '\n'
      + 'Interactive commands (in the running CLI):\n' + formatRows(interactiveHelp) + '\n'
      + 'Assessments are always refused.\n';
}
module.exports={parseCommand,helpText,accuracyStatusText};
