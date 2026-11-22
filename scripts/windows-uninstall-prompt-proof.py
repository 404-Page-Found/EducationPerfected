#!/usr/bin/env python3
"""Native ConPTY proof: accepting the production uninstall prompt must exit."""
import importlib.util, os, pathlib, shutil
root=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('conpty',root/'windows-conpty.py')
conpty=importlib.util.module_from_spec(spec);spec.loader.exec_module(conpty)
code="require('./packaging/uninstall').confirmInnoUninstall().then(ok=>{console.log('UNINSTALL_PROMPT_DONE '+ok);}).catch(e=>{console.error(e);process.exitCode=1;})"
conpty.run_console(shutil.which('node'),['-e',code],dict(os.environ),str(root.parent),[(b'[y/N] ',b'y\r')],b'UNINSTALL_PROMPT_DONE true')
print('Production interactive uninstall confirmation exits on native Windows ConPTY.')
