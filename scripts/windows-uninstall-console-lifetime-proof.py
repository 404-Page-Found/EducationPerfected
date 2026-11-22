#!/usr/bin/env python3
"""Disposable native probe: a removal helper must outlive its parent's console."""
import importlib.util, os, pathlib, shutil, tempfile, time
root=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('conpty',root/'windows-conpty.py')
conpty=importlib.util.module_from_spec(spec);spec.loader.exec_module(conpty)
with tempfile.TemporaryDirectory(prefix='ep-console-lifetime-') as directory:
    owned=pathlib.Path(directory); victim=owned/'inert-delete-me.txt';victim.write_text('inert fixture')
    env=dict(os.environ, EP_PROBE_DIR=directory)
    code="const p=require('node:path'),tmp=process.env.EP_PROBE_DIR;require('./packaging/uninstall-windows').startWindowsUninstallHelper({pid:process.pid,mode:'files',log:p.join(tmp,'helper.log'),files:[p.join(tmp,'inert-delete-me.txt')],tmp,spawnDetached:require('./packaging/windows-helper-spawn').spawnBackgroundHelper}).then(()=>console.log('LIFETIME_HANDOFF_DONE')).catch(e=>{console.error(e);process.exitCode=1})"
    api=conpty.kernel32()
    # This one fixture intentionally leaves the child outside the transport's
    # kill-on-close job, otherwise the test would kill the very helper whose
    # console independence it measures. It can delete only the file above.
    api.AssignProcessToJobObject=lambda job,process:1
    conpty.run_console(shutil.which('node'),['-e',code],env,str(root.parent),expected=b'LIFETIME_HANDOFF_DONE',api=api)
    deadline=time.monotonic()+20
    while victim.exists() and time.monotonic()<deadline:time.sleep(.25)
    log=owned/'helper.log'
    print('CONSOLE_LIFETIME file remains:',victim.exists())
    if log.exists():print(log.read_text(encoding='utf-8-sig',errors='replace'))
    assert not victim.exists(), 'helper did not finish removal after the CLI console closed'
print('Removal helper outlives actual parent CLI and ConPTY closure.')
