const commands = new Set(['setup','check-credentials','forget-credentials','update','uninstall','version','help']);
const commandHelp = [
    ['setup', 'First-time setup: consent to the Chrome download (cached download reused), then optional saved login; no browser or answers'],
    ['setup --browser-only', 'Install-time step for OS installers: download the pinned browser with no prompts and no login step'],
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
];
const interactiveHelp = [
    ['start', 'Start answering (can submit live answers)'],
    ['stop', 'Stop answering'],
    ['status', 'Show current status'],
    ['mode auto', 'Answer and submit automatically (default)'],
    ['mode semi', 'Change live answers but wait for manual submission'],
    ['delay', 'Show the human-paced wait before each submission (on by default: 2-15s by question type; delay off is the provisional Dash recommendation)'],
    ['delay off', 'Restore super speed: no wait between answers'],
    ['delay on', 'Re-enable the human-paced wait'],
    ['refresh', 'Reload the task word lists'],
    ['inspect-self-mark', 'Read-only inspection of a self-mark page'],
    ['inspect-dash', 'Read-only inspection of a Dash round (for shapes the answerer refuses)'],
    ['inspect-components', 'Read-only inspection of a slide\'s question components (for slides the answerer refuses)'],
    ['quit, exit', 'Close the CLI'],
];
function formatRows(rows) {
    const width = Math.max(...rows.map(([name]) => name.length));
    return rows.map(([name, text]) => '  ' + name.padEnd(width) + '  ' + text + '\n').join('');
}
function parseCommand(args) {
    if (!args.length) return {command:'run'};
    // Global help/version win.
    if (args.includes('-h') || args.includes('--help')) return {command:'help'};
    if (args.includes('-v') || args.includes('--version')) return {command:'version'};
    // Legacy helpful error: '--setup' etc. must be written without dashes.
    if (args.length === 1 && args[0].startsWith('--') && commands.has(args[0].slice(2))) return {error:`Use ${args[0].slice(2)} instead of ${args[0]}.`};
    let rest = args.slice();
    // Explicit `run` subcommand is accepted; it takes no options.
    if (rest[0] === 'run') rest = rest.slice(1);
    if (rest[0] && !rest[0].startsWith('-')) {
        // Install-time variant: the OS installer already presented the download
        // notice, so this downloads the pinned browser with no prompts.
        if (rest[0] === 'setup' && rest.length === 2 && rest[1] === '--browser-only') return {command:'setup', browserOnly:true};
        // A leading subcommand (setup, etc.) keeps the strict single-arg rule.
        if (rest.length !== 1) return {error:'Use one subcommand. See help.'};
        const value = rest[0];
        if (commands.has(value)) return {command:value};
        return {error:'Unknown command. See help.'};
    }
    if (rest.length) return {error:`Unknown option ${JSON.stringify(rest[0])}. See help.`};
    return {command:'run'};
}
function helpText() {
    return 'EducationPerfected ' + require('../package.json').version + '\n\n'
      + 'Usage:\n  educationperfected [run]\n  educationperfected <command>\n\n'
      + 'With no command, opens the login browser and interactive CLI; no answers until start.\n'
      + 'Answers are always typed exactly as learned; every answer goes in correct.\n'
      + 'Env override: EP_HUMAN_DELAY=off starts with the answer pacing off.\n\n'
      + 'Commands:\n' + formatRows(commandHelp) + '\n'
      + 'Options:\n' + formatRows(optionHelp) + '\n'
      + 'Interactive commands (in the running CLI):\n' + formatRows(interactiveHelp) + '\n'
      + 'Assessments are always refused.\n';
}
module.exports={parseCommand,helpText};
