import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
env = {key: value for key, value in os.environ.items() if not key.startswith('ORCA_') and key not in ('APPIMAGE', 'APPDIR', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS')}
env.update(XDG_CONFIG_HOME=str(root / 'config'), ORCA_USER_DATA_PATH=str(root / 'config/orca'), ORCA_APP_EXECUTABLE=str(root / 'app/orca-ide'))
if sys.argv[1:2] == ['cli']:
    os.execvpe('/opt/Orca/resources/bin/orca-ide', ['orca-ide', *sys.argv[2:]], env)
os.execve(str(root / 'app/orca-ide'), [str(root / 'app/orca-ide'), '--remote-debugging-port=9232', '--force-renderer-accessibility'], env)
