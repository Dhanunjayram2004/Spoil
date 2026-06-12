from pathlib import Path
text = Path('renderer.js').read_text(encoding='utf-8', errors='ignore')
state='code'
quote=None
escape=False
brace=0
line=1
for i,ch in enumerate(text):
    if ch == '\n':
        if state == 'code':
            print(f'{line}: brace={brace}  {text.splitlines()[line-1]}')
        line += 1
        continue
    if state == 'code':
        if ch == '/' and i + 1 < len(text) and text[i+1] == '/':
            state='line_comment'; continue
        if ch == '/' and i + 1 < len(text) and text[i+1] == '*':
            state='block_comment'; continue
        if ch in ('"', "'"):
            quote = ch; state='string'; continue
        if ch == '`':
            quote = '`'; state='template'; continue
        if ch == '{':
            brace += 1
        elif ch == '}':
            brace -= 1
            if brace < 0:
                print('NEGATIVE BRACE at char', i+1, 'line', line)
    else:
        if state == 'line_comment' and ch == '\n':
            state='code'
        elif state == 'block_comment' and ch == '*' and i + 1 < len(text) and text[i+1] == '/':
            state='code'
            # skip next slash
        elif state == 'string':
            if ch == '\\' and not escape:
                escape = True
            else:
                if ch == quote and not escape:
                    state='code'
                else:
                    escape = False
        elif state == 'template':
            if ch == '\\' and not escape:
                escape = True
            else:
                if ch == '`' and not escape:
                    state='code'
                else:
                    escape = False
