/**
 * Where a finding's prose can be cut, so part of it can be posted.
 *
 * A finding is written as a claim followed by its evidence, and the claim alone
 * is often the whole comment worth sending. Splitting is therefore a posting
 * decision, not a formatting one, and it has to be conservative in one
 * direction: a cut in the wrong place sends half a sentence to a colleague's
 * pull request, while a cut not taken only costs the ability to trim there.
 *
 * Hand written rather than a regex, because the text is engineering prose full
 * of the things that defeat a naive split: `users.customer_id`, `Elysia 1.4.30`,
 * `apps/web/src/index.ts`, `e.g.`. It is also parsed by Hermes on the phone, so
 * there is no lookbehind to lean on.
 */

/**
 * Words whose trailing dot is part of the word. Held without the dot and
 * matched case insensitively.
 *
 * Short on purpose. Every entry suppresses a cut that might have been real, so
 * the list holds only the forms that actually turn up in review prose. `no` is
 * deliberately absent: a sentence ending "the answer is no." is likelier here
 * than the number sign.
 */
const ABBREVIATIONS = [
  "e.g",
  "i.e",
  "eg",
  "ie",
  "etc",
  "vs",
  "cf",
  "al",
  "approx",
  "fig",
  "resp",
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
];

function isTerminator(ch: string): boolean {
  return ch === "." || ch === "!" || ch === "?";
}

/** Closing punctuation a terminator may hide behind: `(like this.)` */
function isCloser(ch: string): boolean {
  return (
    ch === ")" ||
    ch === "]" ||
    ch === '"' ||
    ch === "'" ||
    ch === "”" ||
    ch === "’"
  );
}

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/** Cased and uppercase, including the accented capitals `A-Z` would miss. */
function isUpper(ch: string): boolean {
  return ch.toLowerCase() !== ch;
}

/** Cased at all, either way. */
function isLetter(ch: string): boolean {
  return ch.toLowerCase() !== ch.toUpperCase();
}

/**
 * What a new sentence may begin with.
 *
 * A capital or a digit is the ordinary case. The rest are the openers this prose
 * actually uses: a code span, a quote, a bracketed aside, a markdown marker.
 * Anything else after a full stop is a continuation, which is what keeps
 * `v1.2 and v2` whole.
 */
function startsSentence(ch: string): boolean {
  if (isUpper(ch) || isDigit(ch)) return true;
  return (
    ch === "`" ||
    ch === '"' ||
    ch === "'" ||
    ch === "(" ||
    ch === "[" ||
    ch === "*" ||
    ch === "_" ||
    ch === "#" ||
    ch === "-"
  );
}

/**
 * What a sentence may end on, read immediately before the mark. A word, a
 * number, or the punctuation that closes one.
 */
function endsWord(ch: string): boolean {
  if (ch === "") return false;
  return isLetter(ch) || isDigit(ch) || isCloser(ch) || ch === "`";
}

/** True when the word ending at `dot` carries the dot as part of itself. */
function abbreviated(body: string, dot: number): boolean {
  let start = dot;
  while (start > 0) {
    const ch = body.charAt(start - 1);
    if (isSpace(ch) || ch === "(" || ch === "[" || ch === '"' || ch === "`") {
      break;
    }
    start--;
  }
  const word = body.slice(start, dot);
  if (word.length === 0) return false;
  // An initial, not an end. "J. Smith" is one name.
  if (word.length === 1 && isLetter(word)) return true;
  // A numbered list marker at the head of its line. Elsewhere a bare number
  // before a full stop is the end of a sentence about a quantity.
  let digits = true;
  for (let index = 0; index < word.length; index++) {
    if (!isDigit(word.charAt(index))) digits = false;
  }
  if (digits) {
    let before = start;
    while (
      before > 0 &&
      (body.charAt(before - 1) === " " || body.charAt(before - 1) === "\t")
    ) {
      before--;
    }
    if (before === 0 || body.charAt(before - 1) === "\n") return true;
  }
  return ABBREVIATIONS.indexOf(word.toLowerCase()) >= 0;
}

/**
 * The end offset of every sentence in `body`, ascending, the last being
 * `body.length`.
 *
 * Offsets rather than strings, so the text that goes to GitHub is always a
 * prefix of what the agent wrote and never a rejoin of pieces this module took
 * apart. An empty body has no sentences at all.
 */
export function sentenceCuts(body: string): number[] {
  const cuts: number[] = [];
  let code = false;
  let index = 0;
  while (index < body.length) {
    const ch = body.charAt(index);
    if (ch === "`") {
      code = !code;
      index++;
      continue;
    }
    if (code) {
      index++;
      continue;
    }
    // A blank line ends what came before it whatever its last character was,
    // which is what keeps a heading or a bullet from joining the paragraph
    // below it.
    if (ch === "\n") {
      let ahead = index + 1;
      while (
        ahead < body.length &&
        (body.charAt(ahead) === " " ||
          body.charAt(ahead) === "\t" ||
          body.charAt(ahead) === "\r")
      ) {
        ahead++;
      }
      if (ahead < body.length && body.charAt(ahead) === "\n") {
        if (index > 0) cuts.push(index);
        index = ahead + 1;
        continue;
      }
      index++;
      continue;
    }
    if (!isTerminator(ch) || abbreviated(body, index)) {
      index++;
      continue;
    }
    // A sentence ends on a word, so the mark has to sit against one. This is
    // what keeps `cursor ?? 0` and `results ?? []` whole: there, the question
    // marks are an operator with a space in front of them, and the digit or
    // bracket after the space looks exactly like the start of a new sentence.
    if (!endsWord(body.charAt(index - 1))) {
      index++;
      continue;
    }
    let end = index + 1;
    while (
      end < body.length &&
      (isTerminator(body.charAt(end)) || isCloser(body.charAt(end)))
    ) {
      end++;
    }
    if (end >= body.length) break;
    if (!isSpace(body.charAt(end))) {
      index++;
      continue;
    }
    let next = end;
    let broke = false;
    while (next < body.length && isSpace(body.charAt(next))) {
      if (body.charAt(next) === "\n") broke = true;
      next++;
    }
    // A line break is its own evidence that the thought ended. Within a line the
    // next character has to look like a beginning.
    if (next < body.length && (broke || startsSentence(body.charAt(next)))) {
      cuts.push(end);
      index = end;
      continue;
    }
    index = end;
  }
  if (body.trim().length === 0) return [];
  const last = cuts[cuts.length - 1];
  if (last === undefined || last < body.length) cuts.push(body.length);
  return cuts;
}

/** How many sentences `body` can be posted in parts of. Zero when it is blank. */
export function countSentences(body: string): number {
  return sentenceCuts(body).length;
}

/**
 * The body in pieces, one per sentence, carrying the whitespace between them.
 *
 * Joined with nothing they are the body again, character for character, which
 * is what lets a screen draw the sent part and the dropped part in different
 * colours without redrawing the prose itself. Trimming here would quietly lose
 * the blank line between two paragraphs. AC-AU2.
 */
export function sentencesOf(body: string): string[] {
  const cuts = sentenceCuts(body);
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index < cuts.length; index++) {
    const end = cuts[index] ?? body.length;
    parts.push(body.slice(start, end));
    start = end;
  }
  return parts;
}

/**
 * The first `count` sentences of `body`.
 *
 * `undefined`, or a count that covers the whole thing, returns `body` itself
 * untouched: a comment being sent whole is never routed through this module's
 * idea of where the sentences are. A count of zero or less returns the empty
 * string, which is a caller asking for nothing and is not how a comment is
 * withdrawn.
 */
export function sliceSentences(body: string, count?: number): string {
  if (count === undefined) return body;
  if (count <= 0) return "";
  const cuts = sentenceCuts(body);
  if (count >= cuts.length) return body;
  const end = cuts[count - 1];
  return end === undefined ? body : body.slice(0, end).trimEnd();
}

/**
 * What the slider is set to, in words, so the fill is never the only signal.
 * AC-J3.
 */
export function sliceWord(value: number, count: number): string {
  if (value <= 0) return "Posting nothing.";
  if (value >= count) {
    return count === 1
      ? "Posting the whole finding."
      : `Posting all ${count} sentences.`;
  }
  if (value === 1) return `Posting the first sentence of ${count}.`;
  return `Posting the first ${value} sentences of ${count}.`;
}
