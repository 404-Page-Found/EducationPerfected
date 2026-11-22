#!/usr/bin/env python3
"""Native ConPTY proof: accepting the production uninstall prompt must exit."""
import importlib.util, os, pathlib, shutil
root=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('conpty',root/'windows-conpty.py')
conpty=importlib.util.module_from_spec(spec);spec.loader.exec_module(conpty)
code="require('./packaging/uninstall').confirmInnoUninstall().then(ok=>{console.log('UNINSTALL_PROMPT_DONE '+ok);}).catch(e=>{console.error(e);process.exitCode=1;})"
conpty.run_console(shutil.which('node'),['-e',code],dict(os.environ),str(root.parent),[(b'[y/N] ',b'y\r')],b'UNINSTALL_PROMPT_DONE true')
print('Production interactive uninstall confirmation exits on native Windows ConPTY.')

# The production handoff, with the real CLI process id rather than a marker.
if os.environ.get('INSTALLED_DIR'):
    code="const path=require('node:path');require('./packaging/uninstall').uninstallCommand({executable:path.join(process.env.INSTALLED_DIR,'educationperfected.exe'),store:{remove(){throw Error('unexpected credential access')}},cleanupOwn:async()=>{}}).then(r=>{console.log('UNINSTALL_HANDOFF_DONE '+r.helperStarted)}).catch(e=>{console.error(e);process.exitCode=1;})"
    api=conpty.kernel32()
    wait=api.WaitForSingleObject
    observed=[]
    exits=[]
    get_exit=api.GetExitCodeProcess
    def capture_exit(handle, code):
        ok=get_exit(handle,code)
        if ok:exits.append(code._obj.value)
        return ok
    api.GetExitCodeProcess=capture_exit
    def watched(handle, milliseconds):
        result=wait(handle,milliseconds)
        if milliseconds==30000:observed.append(result)
        return result
    api.WaitForSingleObject=watched
    captured=[]
    try:
        conpty.run_console(shutil.which('node'),['-e',code],dict(os.environ),str(root.parent),[(b'[y/N] ',b'y\r')],b'UNINSTALL_HANDOFF_DONE true',api=api,on_drain=captured.append)
    except conpty.ExitUnconfirmed as error:
        # Only the helper/interactive wizard may survive the CLI. Closing the
        # test-owned job removes those fixture processes, not any user process.
        if str(error)!='job-exit-unconfirmed':raise
    assert exits==[0], 'CLI exit code was not zero: '+str(exits)
    assert observed==[0], 'the actual CLI process did not exit: '+str(observed)
    assert b'UNINSTALL_HANDOFF_DONE true' in b''.join(captured), 'handoff did not finish'
    print('Production confirmation + handoff exits its actual CLI process on native Windows.')
