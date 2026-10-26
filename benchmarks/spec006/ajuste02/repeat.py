"""Sequential validation; persist only test outcomes and known assertion locations."""
import subprocess, json, pathlib, sys, re, time, fcntl
from urllib.parse import unquote
mode=sys.argv[1]
# Keep validation invocations sequential so resource audits cannot see another run.
lock=open(__file__,'r')
fcntl.flock(lock, fcntl.LOCK_EX)
commands={
 'before': [('isolated', ['node','--test','--test-name-pattern=^entrega exige Run', 'tests/workspaces.test.mjs'],30),('suite',['npm','test'],1)],
 'after': [('regressions',['node','--test','--test-name-pattern=entrega','tests/workspaces.test.mjs'],1),('isolated',['node','--test','--test-name-pattern=^entrega exige Run','tests/workspaces.test.mjs'],30),('suite',['npm','test'],3)],
 'final-check': [('check',['npm','run','check'],1),('diff',['git','diff','--check'],1)],
 'validation': [('check',['npm','run','check'],1),('e2e',['npm','run','test:e2e'],1),('diff',['git','diff','--check'],1)]
}
results=[]
initial_dirs={p.name for p in pathlib.Path('/tmp').glob('eros-*')}
initial_pids={p.name for p in pathlib.Path('/proc').iterdir() if p.name.isdigit()}
for stage,cmd,count in commands[mode]:
 for n in range(1,count+1):
  start=time.monotonic()
  r=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=240)
  lines=r.stdout.splitlines()
  result=dict(stage=stage,iteration=n,exitCode=r.returncode,seconds=round(time.monotonic()-start,3),
   summary=[x for x in lines if re.match(r'^(ℹ (tests|pass|fail)|# (tests|pass|fail)) ',x)],
   assertions=[unquote(x.strip()).replace(str(pathlib.Path.cwd()),'<repo>') for x in lines if re.search(r'workspaces.test.mjs:\d+:\d+|actual: .(uncertain|sent).|expected: .(uncertain|sent).',x)])
  new_dirs=[p.name for p in pathlib.Path('/tmp').glob('eros-*') if p.name not in initial_dirs]
  result['remainingFixtureDirectories']=new_dirs
  leftovers=[]
  for proc in pathlib.Path('/proc').iterdir():
   if not proc.name.isdigit() or proc.name in initial_pids: continue
   try:
    command=(proc/'cmdline').read_bytes()
    if b'dist/daemon/entry.cjs' in command or any(d.encode() in command for d in new_dirs): leftovers.append(int(proc.name))
   except (FileNotFoundError,PermissionError,ProcessLookupError): pass
  result['remainingDaemonPids']=leftovers
  results.append(result)
  pathlib.Path(__file__).with_name(mode+'.json').write_text(json.dumps(results,indent=2)+'\n')
  print(stage,n,r.returncode,flush=True)
