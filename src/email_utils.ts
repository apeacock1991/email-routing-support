const QUOTE_PATTERNS = [
  /^>.*$/m,                          // Basic quote: "> text"
  /^On.*wrote:$/m,                   // Common email clients: "On [date] [person] wrote:"
  /^.*<[^>]+>.*wrote:$/m,           // Email with address: "someone <email@domain.com> wrote:"
  /^-{2,}.*Original Message.*-{2,}/m, // "---- Original Message ----"
  /^From:.*Sent:.*To:.*Subject:.*/m,  // Outlook style headers
];

export function extractLatestReply(text: string): string {
  // Find the first occurrence of any quote pattern
  const indices = QUOTE_PATTERNS.map(pattern => {
    const match = text.match(pattern);
    return match ? match.index! : text.length;
  });

  // Get the earliest quote marker
  const firstQuoteIndex = Math.min(...indices);

  // Return everything before the first quote, trimmed
  return text.substring(0, firstQuoteIndex).trim();
} 