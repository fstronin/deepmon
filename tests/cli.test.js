import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const testDir = GLib.path_get_dirname(Gio.File.new_for_uri(import.meta.url).get_path());
const root = GLib.path_get_dirname(testDir);
const cli = GLib.build_filenamev([root, 'bin', 'deepmon-key']);

// spawn_command_line_sync не запускает шелл, поэтому пайпы идут через /bin/sh -c.
function shell(command) {
    const [ok, stdout, stderr] = GLib.spawn_command_line_sync(`/bin/sh -c "${command}"`);
    return {
        ok,
        stdout: new TextDecoder().decode(stdout),
        stderr: new TextDecoder().decode(stderr),
    };
}

export const tests = [
    {name: 'на tty без --stdin читает ключ, а не жалуется на отсутствие ввода', fn: t => {
        const result = shell(`printf 'garbage\\n' | script -qec '${cli} set' /dev/null`);
        t.eq(result.stdout.includes('используйте --stdin'), false);
        t.eq(result.stdout.includes('неверный формат'), true);
    }},
    {name: 'пайп без --stdin отвергается', fn: t => {
        const result = shell(`printf 'sk-abcdefghijklmnop1234' | '${cli}' set`);
        t.eq(result.stderr.includes('используйте --stdin'), true);
    }},
];
