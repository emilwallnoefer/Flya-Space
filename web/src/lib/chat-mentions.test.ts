import { describe, expect, it } from "vitest";
import {
  excerpt,
  insertMention,
  matchMembers,
  mentionTokenAtCaret,
  mentionedMemberIds,
  splitMentions,
  type ChatMember,
} from "./chat-mentions";

const emil: ChatMember = { id: "u1", name: "Emil Wallnöfer", email: "emil.wallnoefer@flyability.com" };
const anna: ChatMember = { id: "u2", name: "Anna Rossi", email: "anna.rossi@flyability.com" };
const annabel: ChatMember = { id: "u3", name: "Annabel Lee", email: "annabel.lee@flyability.com" };
const members = [emil, anna, annabel];

describe("mentionTokenAtCaret", () => {
  it("finds an @ at the start and after whitespace", () => {
    expect(mentionTokenAtCaret("@Em", 3)).toEqual({ start: 0, end: 3, query: "Em" });
    expect(mentionTokenAtCaret("hi @Em", 6)).toEqual({ start: 3, end: 6, query: "Em" });
  });
  it("ignores an @ inside a word (emails)", () => {
    expect(mentionTokenAtCaret("mail me at emil@flya", 20)).toBeNull();
  });
  it("lets the query span one space, not two", () => {
    expect(mentionTokenAtCaret("@Emil Wa", 8)?.query).toBe("Emil Wa");
    expect(mentionTokenAtCaret("@Emil  then", 11)).toBeNull();
  });
  it("only looks before the caret", () => {
    expect(mentionTokenAtCaret("@Emil hello", 2)?.query).toBe("E");
  });
});

describe("matchMembers", () => {
  it("lists everyone for an empty query, alphabetically", () => {
    expect(matchMembers(members, "").map((m) => m.name)).toEqual(["Anna Rossi", "Annabel Lee", "Emil Wallnöfer"]);
  });
  it("matches name words, accents and case folded, whole-name matches first", () => {
    expect(matchMembers(members, "wallno").map((m) => m.id)).toEqual(["u1"]);
    expect(matchMembers(members, "ANN").map((m) => m.id)).toEqual(["u2", "u3"]);
    expect(matchMembers(members, "anna r").map((m) => m.id)).toEqual(["u2"]);
  });
  it("falls back to the email", () => {
    expect(matchMembers(members, "emil.w").map((m) => m.id)).toEqual(["u1"]);
  });
});

describe("insertMention", () => {
  it("replaces the token with the full name and a trailing space", () => {
    const token = mentionTokenAtCaret("hi @em, ok", 6)!;
    expect(insertMention("hi @em, ok", token, emil)).toEqual({ draft: "hi @Emil Wallnöfer , ok", caret: 19 });
  });
});

describe("mentionedMemberIds", () => {
  it("needs the full name and a word boundary", () => {
    expect(mentionedMemberIds("@Emil Wallnöfer can you look?", members)).toEqual(["u1"]);
    expect(mentionedMemberIds("@Emil can you look?", members)).toEqual([]);
    expect(mentionedMemberIds("@Anna Rossi and @Annabel Lee", members).sort()).toEqual(["u2", "u3"]);
    expect(mentionedMemberIds("@Annabel Lee only", members)).toEqual(["u3"]);
  });
  it("is case and accent insensitive, and counts a person once", () => {
    expect(mentionedMemberIds("@emil wallnofer @EMIL WALLNÖFER", members)).toEqual(["u1"]);
  });
  it("returns nothing without an @", () => {
    expect(mentionedMemberIds("Emil Wallnöfer", members)).toEqual([]);
    expect(mentionedMemberIds(null, members)).toEqual([]);
  });
});

describe("splitMentions", () => {
  it("splits text around mentions, longest name first", () => {
    expect(splitMentions("Hey @Annabel Lee, @Anna Rossi!", members)).toEqual([
      { type: "text", value: "Hey " },
      { type: "mention", value: "@Annabel Lee", member: annabel },
      { type: "text", value: ", " },
      { type: "mention", value: "@Anna Rossi", member: anna },
      { type: "text", value: "!" },
    ]);
  });
  it("leaves unknown @ alone", () => {
    expect(splitMentions("ping @nobody", members)).toEqual([{ type: "text", value: "ping @nobody" }]);
  });
});

describe("excerpt", () => {
  it("collapses whitespace, truncates, and falls back to the attachment", () => {
    expect(excerpt("a\n\n b")).toBe("a b");
    expect(excerpt("x".repeat(200)).length).toBe(140);
    expect(excerpt(null, "photo.jpg")).toBe("Attachment: photo.jpg");
    expect(excerpt("", null)).toBe("");
  });
});
