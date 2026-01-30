Execute /speckit.implement for ALL tasks. Complete ALL tasks using speckit commands.
 
Each iteration:
1. Read .speckit/tasks.md
2. Count incomplete tasks (lines without [x])
3. If zero incomplete tasks remain, output <promise>ALL_TASKS_DONE</promise> and stop
4. Otherwise, pick the FIRST incomplete task
5. Execute /speckit.implement for that task
6. Read .speckit/plan.md for architecture context
7. Read .speckit/spec.md for requirements and constraints
8. Implement following the plan's technical decisions
9. Write tests that validate the acceptance criteria
10. Run tests and fix failures
11. Update tasks.md to mark task complete with [x]
12. Commit: git add -A && git commit -m '[speckit] Implement: <task_name>'
 
Constraints:
- Follow the constitution in .speckit/constitution.md
- One task per iteration, smallest possible scope
- Tests must pass before marking complete
- If blocked, document in tasks.md and move to next task
 
Do NOT output the completion promise until tasks.md shows zero incomplete tasks.
