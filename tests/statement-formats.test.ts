import assert from "node:assert/strict";
import { test } from "node:test";
import { describeStatementFormat, detectStatementFormat } from "../src/lib/statement-formats";
import { analyzeStatements } from "../src/lib/recurring-audit";

const today = new Date(2026, 6, 10);

test("detects HDFC-style headers", () => {
  const detection = detectStatementFormat(["Date", "Narration", "Chq/Ref No", "Value Dt", "Withdrawal Amt", "Deposit Amt", "Closing Balance"]);
  assert.equal(detection.profile?.id, "hdfc-netbanking");
  assert.ok(detection.confidence >= 0.8);
  assert.match(describeStatementFormat(detection) ?? "", /HDFC Bank/);
});

test("detects ICICI-style headers", () => {
  const detection = detectStatementFormat(["S No.", "Transaction Date", "Transaction Remarks", "Withdrawal Amount (INR )", "Deposit Amount (INR )", "Balance (INR )"]);
  assert.equal(detection.profile?.id, "icici-netbanking");
});

test("detects Axis-style headers", () => {
  const detection = detectStatementFormat(["Tran Date", "CHQNO", "PARTICULARS", "DEBIT", "CREDIT", "BALANCE"]);
  assert.equal(detection.profile?.id, "axis-netbanking");
});

test("unknown headers return no profile", () => {
  const detection = detectStatementFormat(["foo", "bar", "baz"]);
  assert.equal(detection.profile, null);
  assert.equal(describeStatementFormat(detection), null);
});

test("engine parses HDFC-style exports end to end", () => {
  const text = [
    "Date,Narration,Chq/Ref No,Value Dt,Withdrawal Amt,Deposit Amt,Closing Balance",
    "2026-05-06,OPENAI CHATGPT PLUS,REF991,2026-05-06,1999,,84000",
    "2026-06-06,OPENAI CHATGPT PLUS,REF992,2026-06-06,1999,,82000",
    "2026-06-07,SALARY,REF993,2026-06-07,,95000,177000",
  ].join("\n");

  const audit = analyzeStatements([{ name: "hdfc.csv", text }], [], { today });
  assert.equal(audit.transactions.length, 2, "withdrawal rows parse; deposit rows are excluded");
  assert.equal(audit.recurringItems.length, 1);
  assert.equal(audit.recurringItems[0].merchant, "OpenAI");
});

test("engine parses ICICI-style exports end to end", () => {
  const text = [
    "Transaction Date,Transaction Remarks,Withdrawal Amount (INR ),Deposit Amount (INR ),Balance (INR )",
    "2026-05-02,GITHUB COPILOT BUSINESS,1520,,50000",
    "2026-06-02,GITHUB COPILOT BUSINESS,1520,,48480",
  ].join("\n");

  const audit = analyzeStatements([{ name: "icici.csv", text }], [], { today });
  assert.equal(audit.recurringItems.length, 1);
  assert.equal(audit.recurringItems[0].merchant, "GitHub");
});
