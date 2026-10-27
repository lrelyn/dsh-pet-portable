"""读取 docx 全文（含表格，按文档顺序），输出 UTF-8 markdown。

用法: python read_docx.py <input.docx> <output.md>
"""
import sys
from pathlib import Path

from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph
from docx.oxml.ns import qn


def iter_block_items(parent):
    body = parent.element.body
    for child in body.iterchildren():
        if child.tag == qn('w:p'):
            yield Paragraph(child, parent)
        elif child.tag == qn('w:tbl'):
            yield Table(child, parent)


def table_text(t: Table) -> str:
    lines = []
    for row in t.rows:
        cells = [' '.join(c.text.split()) for c in row.cells]
        lines.append('| ' + ' | '.join(cells) + ' |')
    return '\n'.join(lines)


def main(src: str, dst: str):
    doc = Document(src)
    out = []
    for block in iter_block_items(doc):
        if isinstance(block, Paragraph):
            txt = block.text.strip()
            if not txt:
                continue
            style = block.style.name if block.style else ''
            if style.startswith('Heading') or style.startswith('标题'):
                lvl = ''.join(ch for ch in style if ch.isdigit()) or '1'
                out.append('#' * min(int(lvl), 6) + ' ' + txt)
            elif 'List' in style:
                out.append('- ' + txt)
            else:
                out.append(txt)
        elif isinstance(block, Table):
            out.append(table_text(block))
            out.append('')
    Path(dst).write_text('\n'.join(out), encoding='utf-8')
    print(f'written {dst} ({len(out)} blocks)')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
