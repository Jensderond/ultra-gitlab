import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline, resolveHref, type Block, type Inline } from './Markdown';

const text = (t: string): Inline => ({ type: 'text', text: t });

describe('parseBlocks', () => {
  it('splits paragraphs on blank lines and keeps soft breaks inside', () => {
    expect(parseBlocks('one\ntwo\n\nthree')).toEqual([
      { type: 'paragraph', text: 'one\ntwo' },
      { type: 'paragraph', text: 'three' },
    ]);
  });

  it('parses ATX and setext headings', () => {
    expect(parseBlocks('# Title #\n## Sub\nPara\n===\n\nOther\n---')).toEqual([
      { type: 'heading', level: 1, text: 'Title' },
      { type: 'heading', level: 2, text: 'Sub' },
      { type: 'heading', level: 1, text: 'Para' },
      { type: 'heading', level: 2, text: 'Other' },
    ]);
  });

  it('does not treat #123 as a heading', () => {
    expect(parseBlocks('#123 fixed')).toEqual([{ type: 'paragraph', text: '#123 fixed' }]);
  });

  it('parses fenced code with language and keeps content verbatim', () => {
    expect(parseBlocks('```ts\nconst a = **1**;\n\n<b>x</b>\n```\nafter')).toEqual([
      { type: 'code', lang: 'ts', text: 'const a = **1**;\n\n<b>x</b>' },
      { type: 'paragraph', text: 'after' },
    ]);
  });

  it('treats an unclosed fence as running to the end', () => {
    expect(parseBlocks('~~~\na\nb')).toEqual([{ type: 'code', lang: '', text: 'a\nb' }]);
  });

  it('recognises GitLab suggestion fences', () => {
    expect(parseBlocks('```suggestion:-0+1\nconst x = 2;\n```')).toEqual([
      { type: 'suggestion', text: 'const x = 2;' },
    ]);
    expect(parseBlocks('```suggestion\n```')).toEqual([{ type: 'suggestion', text: '' }]);
  });

  it('parses indented code', () => {
    expect(parseBlocks('    a\n      b')).toEqual([{ type: 'code', lang: '', text: 'a\n  b' }]);
  });

  it('parses blockquotes recursively', () => {
    expect(parseBlocks('> quote\n> - item')).toEqual([
      {
        type: 'quote',
        children: [
          { type: 'paragraph', text: 'quote' },
          { type: 'list', ordered: false, start: 1, items: [{ task: null, children: [{ type: 'paragraph', text: 'item' }] }] },
        ],
      },
    ]);
  });

  it('parses nested and ordered lists', () => {
    const [list] = parseBlocks('3. one\n4. two\n   - nested a\n   - nested b\n5. three') as [
      Extract<Block, { type: 'list' }>,
    ];
    expect(list.ordered).toBe(true);
    expect(list.start).toBe(3);
    expect(list.items).toHaveLength(3);
    expect(list.items[1].children).toEqual([
      { type: 'paragraph', text: 'two' },
      {
        type: 'list',
        ordered: false,
        start: 1,
        items: [
          { task: null, children: [{ type: 'paragraph', text: 'nested a' }] },
          { task: null, children: [{ type: 'paragraph', text: 'nested b' }] },
        ],
      },
    ]);
  });

  it('keeps a list together across blank lines between items', () => {
    const [list] = parseBlocks('- a\n\n- b') as [Extract<Block, { type: 'list' }>];
    expect(list.items).toHaveLength(2);
  });

  it('separates lists with different bullets', () => {
    expect(parseBlocks('- a\n* b').map((b) => b.type)).toEqual(['list', 'list']);
  });

  it('parses task lists', () => {
    const [list] = parseBlocks('- [ ] todo\n- [x] done\n- plain') as [Extract<Block, { type: 'list' }>];
    expect(list.items.map((i) => i.task)).toEqual([false, true, null]);
    expect(list.items[0].children).toEqual([{ type: 'paragraph', text: 'todo' }]);
  });

  it('lets a list interrupt a paragraph', () => {
    expect(parseBlocks('Changes:\n- one\n- two').map((b) => b.type)).toEqual(['paragraph', 'list']);
  });

  it('supports lazy continuation lines in list items', () => {
    const [list] = parseBlocks('- first line\ncontinued') as [Extract<Block, { type: 'list' }>];
    expect(list.items[0].children).toEqual([{ type: 'paragraph', text: 'first line\ncontinued' }]);
  });

  it('parses tables with alignment and escaped pipes', () => {
    expect(parseBlocks('| a | b | c |\n|:--|:-:|--:|\n| 1 | `x|y` | 3 \\| 4 |')).toEqual([
      {
        type: 'table',
        align: ['left', 'center', 'right'],
        header: ['a', 'b', 'c'],
        rows: [['1', '`x|y`', '3 | 4']],
      },
    ]);
  });

  it('parses horizontal rules', () => {
    expect(parseBlocks('a\n\n***\n\n- - -')).toEqual([
      { type: 'paragraph', text: 'a' },
      { type: 'hr' },
      { type: 'hr' },
    ]);
  });

  it('strips HTML comments and script blocks, but not inside code fences', () => {
    expect(parseBlocks('a <!-- hidden\nstill hidden --> b')).toEqual([{ type: 'paragraph', text: 'a  b' }]);
    expect(parseBlocks('x <script>alert(1)</script> y')).toEqual([{ type: 'paragraph', text: 'x  y' }]);
    expect(parseBlocks('```html\n<!-- keep -->\n```')).toEqual([{ type: 'code', lang: 'html', text: '<!-- keep -->' }]);
  });

  it('normalises CRLF', () => {
    expect(parseBlocks('a\r\n\r\nb')).toHaveLength(2);
  });
});

describe('parseInline', () => {
  it('parses emphasis, strong and strikethrough', () => {
    expect(parseInline('*a* **b** _c_ __d__ ~~e~~')).toEqual([
      { type: 'em', children: [text('a')] },
      text(' '),
      { type: 'strong', children: [text('b')] },
      text(' '),
      { type: 'em', children: [text('c')] },
      text(' '),
      { type: 'strong', children: [text('d')] },
      text(' '),
      { type: 'del', children: [text('e')] },
    ]);
  });

  it('nests emphasis inside strong and vice versa', () => {
    expect(parseInline('**bold *it***')).toEqual([
      { type: 'strong', children: [text('bold '), { type: 'em', children: [text('it')] }] },
    ]);
    expect(parseInline('*it **bold***')).toEqual([
      { type: 'em', children: [text('it '), { type: 'strong', children: [text('bold')] }] },
    ]);
  });

  it('leaves intraword underscores and lone markers alone', () => {
    expect(parseInline('snake_case_name and 2 * 3 * 4')).toEqual([text('snake_case_name and 2 * 3 * 4')]);
  });

  it('parses code spans without interpreting their content', () => {
    expect(parseInline('use `**x**` and ``a`b``')).toEqual([
      text('use '),
      { type: 'code', text: '**x**' },
      text(' and '),
      { type: 'code', text: 'a`b' },
    ]);
  });

  it('parses links with titles and nested formatting', () => {
    expect(parseInline('[**docs**](https://x.y/a_(b) "The docs")')).toEqual([
      {
        type: 'link',
        href: 'https://x.y/a_(b)',
        title: 'The docs',
        children: [{ type: 'strong', children: [text('docs')] }],
      },
    ]);
  });

  it('parses images as image nodes', () => {
    expect(parseInline('![shot](/uploads/abc/shot.png)')).toEqual([
      { type: 'image', href: '/uploads/abc/shot.png', alt: 'shot' },
    ]);
  });

  it('autolinks bare and bracketed URLs, trimming trailing punctuation', () => {
    expect(parseInline('see https://gitlab.com/a/b. and <https://x.y>')).toEqual([
      text('see '),
      { type: 'link', href: 'https://gitlab.com/a/b', children: [text('https://gitlab.com/a/b')] },
      text('. and '),
      { type: 'link', href: 'https://x.y', children: [text('https://x.y')] },
    ]);
    expect(parseInline('(https://x.y/z)')).toEqual([
      text('('),
      { type: 'link', href: 'https://x.y/z', children: [text('https://x.y/z')] },
      text(')'),
    ]);
  });

  it('parses mentions but not e-mail addresses', () => {
    expect(parseInline('ping @jens.de-rond, mail a@b.c')).toEqual([
      text('ping '),
      { type: 'mention', name: 'jens.de-rond' },
      text(', mail a@b.c'),
    ]);
  });

  it('parses MR and issue references, including cross-project', () => {
    expect(parseInline('See !12, #34 and group/proj!5 but not a#1')).toEqual([
      text('See '),
      { type: 'ref', kind: 'mr', project: '', num: 12, text: '!12' },
      text(', '),
      { type: 'ref', kind: 'issue', project: '', num: 34, text: '#34' },
      text(' and '),
      { type: 'ref', kind: 'mr', project: 'group/proj', num: 5, text: 'group/proj!5' },
      text(' but not a#1'),
    ]);
  });

  it('never passes raw HTML through', () => {
    expect(parseInline('a<br>b <script>alert(1)</script> <b>bold</b>')).toEqual([
      text('a'),
      { type: 'br' },
      text('b <script>alert(1)</script> bold'),
    ]);
    expect(parseInline('<img src="/uploads/x.png" alt="pic">')).toEqual([
      { type: 'image', href: '/uploads/x.png', alt: 'pic' },
    ]);
  });

  it('keeps generic-looking text literal', () => {
    expect(parseInline('Array<string> and a < b')).toEqual([text('Array<string> and a < b')]);
  });

  it('handles escapes, hard breaks and emoji', () => {
    expect(parseInline('\\*not em\\* :tada:')).toEqual([text('*not em* 🎉')]);
    expect(parseInline('one  \ntwo\\\nthree\nfour')).toEqual([
      text('one'),
      { type: 'br' },
      text('two'),
      { type: 'br' },
      text('three four'),
    ]);
  });
});

describe('resolveHref', () => {
  it('allows http(s) and mailto only', () => {
    expect(resolveHref('https://a.b')).toBe('https://a.b');
    expect(resolveHref('mailto:x@y.z')).toBe('mailto:x@y.z');
    expect(resolveHref('javascript:alert(1)')).toBeNull();
    expect(resolveHref('JaVaScRiPt:alert(1)', 'https://g.l/p')).toBeNull();
    expect(resolveHref('data:text/html,x', 'https://g.l/p')).toBeNull();
  });

  it('resolves uploads and relative links against the project', () => {
    expect(resolveHref('/uploads/abc/a.png', 'https://g.l/grp/proj')).toBe('https://g.l/grp/proj/uploads/abc/a.png');
    expect(resolveHref('docs/x.md', 'https://g.l/grp/proj/')).toBe('https://g.l/grp/proj/docs/x.md');
    expect(resolveHref('docs/x.md')).toBeNull();
    expect(resolveHref('/uploads/a.png', 'https://g.l/grp/proj/-/merge_requests/4')).toBe('https://g.l/grp/proj/uploads/a.png');
  });
});
