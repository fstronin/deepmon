import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class ShellNotifier {
    notify({title, body}) {
        Main.notify(title, body);
    }
}
