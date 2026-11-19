# Disclaimer — please read before use

This page explains the risks and responsibilities of using EducationPerfected.
It is not legal advice. If you do not accept these points, do not use the program.

## 1. What this software does

EducationPerfected automates answers on Education Perfect, including
filling, selecting, and submitting answers on your behalf, and working
around parts of Education Perfect's anti-cheat behaviour. That is its
stated purpose. Do not treat it as a neutral study aid: on a graded or
assigned task, automated answering can misrepresent your work.

The program's capabilities and limits change over time. What worked on
one task, question type, or site layout may stop working, refuse, or
behave differently after Education Perfect changes. See the README's
status and known limitations, and the [changelog](../CHANGELOG.md), for
what is currently claimed to work.

## 2. No affiliation with Education Perfect

This project is an independent continuation of an archived hobby
project. It is not made, endorsed, supported, or approved by Education
Perfect. Education names, marks, and service content remain the property
of their respective owners.

Nothing here grants permission to use Education Perfect's services or
to access them automatically. Service use may be subject to
[Education Perfect's terms of service](https://www.educationperfect.com/).

## 3. School rules and service rules are your responsibility

Automated answering may breach some or all of:

- your school's academic-integrity, assessment, or acceptable-use policies;
- your teacher's instructions for a particular task;
- Education Perfect's terms or usage rules for your account.

Only you can check whether a given use is allowed. Students who choose
to use this product do so at their own responsibility, and it is not
recommended to use it for homework tasks. When in doubt:

- ask your teacher or school before running automation on assigned,
  graded, or timed work;
- use your own account only, and do not run the program on someone
  else's account, device, or work;
- if you are under 18, involve a parent, guardian, or teacher in that
  decision.

Self-test or practice work is not risk-free either: completed work,
points, timing, and attempts can remain visible to teachers.

## 4. Detection, grading, and account consequences

There is no promise that automation is undetectable, correct, or safe
for your marks or account. In particular:

- Education Perfect or your school may detect automation, unusual speed,
  timing, input patterns, focus changes, or assessment signals, and may
  flag, invalidate, re-mark, or otherwise act on the attempt.
- The README notes timing and assessment signals explicitly: teachers
  may review time spent, self-test work still earns points and stays
  visible, and assessment attempts can autosave answers and track focus
  or navigation. This program refuses assessment shapes rather than
  answering them, but that refusal cannot promise what the service has
  already saved or recorded on its own.
- Answers may be wrong: word-list parsing edge cases, changed layouts,
  lag, partial fills, or a stop partway through a question can leave an
  incorrect, incomplete, or already-saved answer behind. Stopping the
  program cannot undo a key press, click, fill, or Submit already
  delivered, including selections or inputs the service may save or
  grade without an explicit Submit.
- The anti-cheat workaround is described in the README as currently not
  tripping detection. That is an observation about past runs, not a
  guarantee. It may stop working or become detectable when Education
  Perfect changes.

You accept the risk of lost marks, redone work, disciplinary action,
restricted access, or account consequences if you use automation where
it is not permitted, or if anything goes wrong while it runs.

## 5. No warranty; use at your own risk

The code and documentation are provided "as is", without warranty of
any kind, including merchantability, fitness for a particular purpose,
and non-infringement, as stated in the [LICENSE](../LICENSE). To the
extent permitted by law, the contributors are not liable for claims,
damages, or other liability arising from the software or its use,
including school, grading, or account outcomes, or for reliance on
dated verification claims after the service changes.

Run the program only in a way you are prepared to explain and accept
responsibility for. Supervise it while it runs: do not leave graded
automation unattended, navigate away mid-question, or hand a supervised
validation step to someone else without fresh permission where the docs
require it.

## 6. Credentials and privacy

- Auto-login only fills Education Perfect's own username/password form.
  School SSO, Google, Microsoft, Clever, and any CAPTCHA must be
  completed by hand; the program does not touch those flows.
- Prefer environment variables or the OS credential store described in
  [docs/developer-guide.md](developer-guide.md#cli-credential-setup-source-build). Keep credential values out of source files, screenshots,
  shared logs, and pasted diagnostics, and never put a password in a
  command argument.
- Most refusal diagnostics are designed to stay content-free
  (counts, guard names, and shape flags rather than question, option,
  or answer text), but dropdown refusal output is an exception: it
  includes displayed option text, values, and selections, while the
  read-only `inspect` command omits them (see "Dropdown refusal
  diagnostics" in [question-types.md](question-types.md)). Pasted terminal output can still
  reveal how and when automation was used. Share logs only with people
  you trust, and redact option text, values, selections, and anything
  sensitive first.

## 7. License and distribution limits

The [MIT license](../LICENSE) in this repository applies only to
contributions whose rights holders have authorized that grant; it does
not license the entire repository, clear other contributors' rights, or
authorize distribution of the whole checkout or a bundled browser.
Third-party components retain their own licenses and notices. Release,
signing, browser-redistribution, and notice-completeness checks
described under `release/` remain unchanged by this page.

Do not distribute a binary without its notices or before completing the
project's rights, licensing, browser-redistribution, signing, and
release checks.

## Short version

Independent hobby project, not affiliated with Education Perfect.
Automating schoolwork can violate school or service rules and can be
detected, marked wrong, or acted on. No warranty, no liability, no
promise it keeps working. Students who choose to use this product do so
at their own responsibility, and it is not recommended to use it for
homework tasks. Use only where you have permission, on your
own account, and at your own risk.
