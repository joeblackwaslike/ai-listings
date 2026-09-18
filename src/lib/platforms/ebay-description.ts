const HTML_TAG_RE = /<[a-z][\s\S]*?>/i

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Converts a plain-text eBay description to HTML.
 * Paragraphs are separated by blank lines; single newlines become <br>.
 * Key-value lines (e.g. "Condition: ...") get a bolded key.
 * Pass-through if the string already contains HTML tags.
 */
export function plaintextToEbayHtml(text: string): string {
  if (!text) return text
  if (HTML_TAG_RE.test(text)) return text

  const paragraphs = text.split(/\n{2,}/)
  const htmlParagraphs = paragraphs.map((para) => {
    const lines = para.split('\n').map((line) => {
      const escapedLine = escapeHtml(line)
      // Bold the key in "Key: value" lines
      return escapedLine.replace(/^([A-Z][A-Za-z\s/]+):\s+/, '<strong>$1:</strong> ')
    })
    return `<p>${lines.join('<br>\n')}</p>`
  })

  return `<div>\n${htmlParagraphs.join('\n')}\n</div>`
}
