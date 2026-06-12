---
name: chatbot-workspace-rules
description: Workspace rules for conserving credits and limiting tool/file usage when working in this chatbot project.
---

# Chatbot Workspace Rules

## Credit Saving Rules

1. Limit each user request to a maximum of 2 work loops.
2. If the task is not complete after 2 loops, stop and report the current status to the user.
3. Do not automatically scan the whole project.
4. Do not read unrelated files unless the user names them or approves them first.
5. Before using any skill, tool, command, or file read/write action, briefly explain why it is needed and wait for user approval.
6. Keep responses short and direct.
7. Output only necessary code or commands when code or commands are requested.
8. Do not repeatedly auto-fix errors. Try once, then at most one additional correction if approved or clearly necessary within the 2-loop limit.

## Default Behavior

- Ask before reading, writing, running, installing, deleting, moving, or scanning files.
- Prefer targeted checks over broad searches.
- Avoid long explanations and history summaries.
- If more context is needed, ask for the exact file or permission first.
