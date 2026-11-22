#!/usr/bin/env python3
"""Exercise the actual draft CLI, never a user install or credential store."""
import importlib.util, os, pathlib
root=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('conpty',root/'windows-conpty.py')
conpty=importlib.util.module_from_spec(spec);spec.loader.exec_module(conpty)
exe=pathlib.Path(os.environ['INSTALLED_DIR'])/'educationperfected.exe'
assert exe.is_file()
for answer, expected in [(b'n\r',b'Uninstall cancelled'),(b'y\r',b'The uninstaller starts after this program exits')]:
    api=conpty.kernel32();wait=api.WaitForSingleObject;observed=[];captured=[]
    def watched(handle,milliseconds):
        result=wait(handle,milliseconds)
        if milliseconds==30000:observed.append(result)
        return result
    api.WaitForSingleObject=watched
    error=None
    try:
        conpty.run_console(str(exe),['uninstall'],dict(os.environ),str(exe.parent),[(b'[y/N] ',answer)],expected,api=api,on_drain=captured.append)
    except BaseException as caught:error=caught
    print('Packaged answer:',answer.rstrip().decode(),'main exit wait:',observed,'outcome:',str(error) if error else 'clean')
    print('--- packaged output ---\n'+b''.join(captured).decode('utf-8','replace')+'\n--- end ---')
    assert observed==[0], 'packaged CLI did not exit'
    if error and str(error)!='job-exit-unconfirmed':raise error
    assert expected in b''.join(captured)
print('Actual draft packaged uninstall exits after both default-No and accepted prompts.')
