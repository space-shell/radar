import "./guard.mjs";
import {
  countSentences,
  sentenceCuts,
  sentencesOf,
  sliceSentences,
  sliceWord,
} from "../shared/sentences.ts";
import {
  anchorKey,
  commentBody,
  draftSchema,
  emptyDraft,
} from "../shared/feedback.ts";

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `${ok ? "pass" : "FAIL"}  ${name}${ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`,
  );
};

const finding = (body) => ({
  path: "src/a.ts",
  line: 10,
  side: "RIGHT",
  severity: "blocking",
  body,
});

// AU1. The split itself, on the shapes a finding is actually written in.
check("AU1 two plain sentences", sentencesOf("This leaks. Close the handle."), [
  "This leaks.",
  " Close the handle.",
]);
check(
  "AU1 the segments rejoin to the original exactly",
  sentencesOf("One. Two.  Three.").join(""),
  "One. Two.  Three.",
);
check(
  "AU1 a question and an exclamation end a sentence too",
  countSentences("Is this reachable? It is. Fix it!"),
  3,
);
check(
  "AU1 a trailing fragment with no terminator is its own sentence",
  countSentences("This leaks. Close the handle"),
  2,
);
check("AU1 one sentence is one", countSentences("This leaks."), 1);
check("AU1 an empty body has no sentences", countSentences(""), 0);
check("AU1 whitespace alone has none either", countSentences("   \n  "), 0);

// AU2. The cuts a naive split on `. ` gets wrong, every one of them taken from
// a real finding body on disk.
check(
  "AU2 a decimal is not a boundary",
  countSentences("The timeout is 1.5 seconds and that is too long."),
  1,
);
check(
  "AU2 an abbreviation is not a boundary",
  countSentences("Pass a tag, e.g. the commit sha, so the cache is keyed."),
  1,
);
check(
  "AU2 a version number is not a boundary",
  countSentences("Node 22.11.0 ships it, so the polyfill is dead weight."),
  1,
);
check(
  "AU2 an initial is not a boundary",
  countSentences("Named after J. Doe, which the schema still encodes."),
  1,
);
/*
 * The `??` case, which is why `endsWord` exists. The operator always has a
 * space in front of it, so a `?` that is not preceded by a word character is
 * never a terminator. Without the rule this split as `Number(cursor ??` plus
 * `0) reads an empty string...`.
 */
check(
  "AU2 a nullish coalescing operator is not a boundary",
  countSentences("Number(cursor ?? 0) reads an empty string as zero."),
  1,
);
check(
  "AU2 nor is one inside a spread",
  countSentences("The call `push(...(batch?.results ?? []))` drops the page."),
  1,
);
check(
  "AU2 a full stop inside a code span is not a boundary",
  countSentences("Call `a.b(); c.d()` once. Then read the result."),
  2,
);
check(
  "AU2 and a code span holding a whole sentence stays one",
  countSentences("Write `done. ok` to the file and the parser accepts it."),
  1,
);
check(
  "AU2 a file extension mid sentence is not a boundary",
  countSentences("The import of utils.ts is circular and the build knows."),
  1,
);
check(
  "AU2 a blank line is a boundary with or without a terminator",
  countSentences("A heading\n\nAnd the body that follows it."),
  2,
);
check(
  "AU2 a lower case start after a full stop is not a boundary",
  countSentences("See config.default for the shape it expects."),
  1,
);

// AU3. The slice is a prefix of the body, never a rejoin, so no wording the
// agent wrote can be altered on the way out.
{
  const body = "This leaks. Close the handle. The test proves it.";
  check("AU3 one sentence", sliceSentences(body, 1), "This leaks.");
  check(
    "AU3 two sentences",
    sliceSentences(body, 2),
    "This leaks. Close the handle.",
  );
  check("AU3 all three is the body itself", sliceSentences(body, 3), body);
  check(
    "AU3 a count past the end is still the body",
    sliceSentences(body, 99),
    body,
  );
  check("AU3 no count at all is the body", sliceSentences(body), body);
  check("AU3 zero is nothing", sliceSentences(body, 0), "");
  check(
    "AU3 every slice is a prefix of the body",
    [1, 2, 3].every((n) => body.startsWith(sliceSentences(body, n))),
    true,
  );
  check(
    "AU3 and the body is returned by identity, not rebuilt",
    sliceSentences(body, 3) === body,
    true,
  );
}
check(
  "AU3 a slice never ends inside a code span",
  sliceSentences("Call `a.b(); c.d()` once, then read it. Then stop.", 1),
  "Call `a.b(); c.d()` once, then read it.",
);
check(
  "AU3 the cuts and the segments agree",
  sentenceCuts("One. Two. Three.").length,
  sentencesOf("One. Two. Three.").length,
);

// AU4. The stored count rides as an optional key, never a new enum member, so
// an older reader strips it rather than dropping the whole record. The rule is
// load bearing: `readInboxState` discards a record whose parse fails.
{
  const draft = emptyDraft();
  draft.comments["RIGHT:10:src/a.ts"] = {
    include: true,
    text: "",
    sentences: 2,
  };
  const parsed = draftSchema.safeParse(draft);
  check("AU4 a draft carrying a count parses", parsed.success, true);
  check(
    "AU4 and the count survives the parse",
    parsed.data?.comments["RIGHT:10:src/a.ts"]?.sentences,
    2,
  );
  check(
    "AU4 a draft with no count parses as well",
    draftSchema.safeParse(emptyDraft()).success,
    true,
  );
  check(
    "AU4 zero is refused, because nothing posted is the include switch",
    draftSchema.safeParse({
      ...emptyDraft(),
      comments: { a: { include: true, text: "", sentences: 0 } },
    }).success,
    false,
  );
  check(
    "AU4 an unknown key is stripped rather than rejected",
    draftSchema.safeParse({
      ...emptyDraft(),
      comments: { a: { include: true, text: "", invented: 3 } },
    }).success,
    true,
  );
}

// AU5. What actually goes to GitHub.
{
  const body = "This leaks. Close the handle. The test proves it.";
  const item = finding(body);
  const key = anchorKey(item);
  const draft = (comment) => ({
    ...emptyDraft(),
    comments: { [key]: comment },
  });

  check(
    "AU5 no stored count posts the whole finding",
    commentBody(item, draft({ include: true, text: "" })),
    body,
  );
  check(
    "AU5 a count of one posts the first sentence",
    commentBody(item, draft({ include: true, text: "", sentences: 1 })),
    "This leaks.",
  );
  check(
    "AU5 a count covering everything posts the body unchanged",
    commentBody(item, draft({ include: true, text: "", sentences: 3 })),
    body,
  );
  /*
   * The replacement is never cut. The slider trims the agent's wording; a
   * sentence James typed himself is his, whole, and a slice applied to it
   * would silently delete words he wrote.
   */
  check(
    "AU5 a typed replacement is sent whole, count or no count",
    commentBody(
      item,
      draft({ include: true, text: "Just close it.", sentences: 1 }),
    ),
    "Just close it.",
  );
  check(
    "AU5 a replacement of whitespace is not a replacement",
    commentBody(item, draft({ include: true, text: "   ", sentences: 1 })),
    "This leaks.",
  );
  check(
    "AU5 a finding with no comment at all posts whole",
    commentBody(item, emptyDraft()),
    body,
  );
  /*
   * The key digests the body, so rewording a finding drops the slice with the
   * replacement. Self invalidating, and the right loss: a count of two means
   * nothing against sentences that no longer exist.
   */
  check(
    "AU5 a reworded finding loses the count with its key",
    commentBody(
      finding("Rewritten. Entirely."),
      draft({ include: true, text: "", sentences: 1 }),
    ),
    "Rewritten. Entirely.",
  );
}

// AU6. The word under the slider, which is what carries the setting where the
// fill cannot. AC-J3.
check("AU6 nothing", sliceWord(0, 4), "Posting nothing.");
check("AU6 the first", sliceWord(1, 4), "Posting the first sentence of 4.");
check("AU6 some", sliceWord(3, 4), "Posting the first 3 sentences of 4.");
check("AU6 all", sliceWord(4, 4), "Posting all 4 sentences.");
check(
  "AU6 past the end still reads as all",
  sliceWord(9, 4),
  "Posting all 4 sentences.",
);
check(
  "AU6 a single sentence finding is a whole finding",
  sliceWord(1, 1),
  "Posting the whole finding.",
);

console.log(failures === 0 ? "\nall pass" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
