import { describe, expect, it } from "vitest";
import { attributeSeparateDeliveryNotice, type VerifiedSentNoticeTarget, type SeparateNoticeMessage } from "@/lib/crm/separate-delivery-notice";
const target: VerifiedSentNoticeTarget = { providerMessageId: "aa1", providerThreadId: "aa2", rfcMessageId: "<original@example.com>", senderEmail: "mrosser@rossergallery.com", recipientEmail: "recipient@example.com", sentAt: "2026-11-03T08:00:00Z" };
const encode = (text: string) => Buffer.from(text).toString("base64url");
function fixture(action = "failed", status = "5.1.1"): SeparateNoticeMessage {
  return { id: "bb1", threadId: "bb2", internalDate: String(Date.parse("2026-11-03T08:01:00Z")), labelIds: ["INBOX"], payload: { mimeType: "multipart/report", headers: [ {name:"From",value:"Mail Delivery Subsystem <mailer-daemon@googlemail.com>"}, {name:"To",value:target.senderEmail}, {name:"Content-Type",value:'multipart/report; report-type="delivery-status"'} ], parts: [ {mimeType:"text/plain",body:{data:encode("Private raw message text")}}, {mimeType:"message/delivery-status",body:{data:encode(`Reporting-MTA: dns; googlemail.com\r\n\r\nFinal-Recipient: rfc822; ${target.recipientEmail}\r\nAction: ${action}\r\nStatus: ${status}\r\n`)}}, {mimeType:"message/rfc822",body:{data:encode(`Message-ID: ${target.rfcMessageId}\r\nFrom: ${target.senderEmail}\r\nTo: ${target.recipientEmail}\r\n\r\nOriginal private body`)}} ] } };
}
describe("separate-thread delivery report attribution", () => {
  it("requires attached original identity and recipient; preserves the actual separate thread", () => {
    expect(attributeSeparateDeliveryNotice(fixture(),target)).toMatchObject({providerThreadId:"bb2",originalProviderThreadId:"aa2",reportedAction:"failed",enhancedStatus:"5.1.1"});
  });
  it("returns no bodies, headers, recipient addresses, or original RFC identifiers", () => {
    expect(JSON.stringify(attributeSeparateDeliveryNotice(fixture(),target))).not.toMatch(/example.com|rossergallery|Private|Original private|headers|payload/);
  });
  it.each([["delayed","4.4.1"],["delivered","2.0.0"],["relayed","2.0.0"],["expanded","2.0.0"]])("preserves reported %s rather than labelling every notice a bounce", (action,status) => {
    expect(attributeSeparateDeliveryNotice(fixture(action,status),target)?.reportedAction).toBe(action);
  });
  it.each([["failed","4.1.1"],["delayed","5.1.1"],["delivered","5.1.1"],["unknown","5.1.1"]])("rejects contradictory action %s status %s", (action,status) => expect(attributeSeparateDeliveryNotice(fixture(action,status),target)).toBeNull());
  it("does not attribute by subject, recipient, or timestamp alone", () => {
    const message=fixture(); message.payload!.parts!.pop();
    expect(attributeSeparateDeliveryNotice(message,target)).toBeNull();
    expect(attributeSeparateDeliveryNotice(fixture(),{...target,rfcMessageId:"<different@example.com>"})).toBeNull();
    expect(attributeSeparateDeliveryNotice(fixture(),{...target,recipientEmail:"other@example.com"})).toBeNull();
  });
  it("rejects sender spoof candidates and wrong destination", () => {
    for (const index of [0,1]) { const message=fixture(); message.payload!.headers![index].value="unrelated@example.com"; expect(attributeSeparateDeliveryNotice(message,target)).toBeNull(); }
  });
  it("rejects duplicate headers, multiple recipients and ambiguous attached originals", () => {
    const duplicate=fixture();duplicate.payload!.headers!.push({name:"To",value:target.senderEmail});expect(attributeSeparateDeliveryNotice(duplicate,target)).toBeNull();
    const recipients=fixture(); recipients.payload!.parts![1].body!.data=encode(`Final-Recipient: rfc822; ${target.recipientEmail}\r\nAction: failed\r\nStatus: 5.1.1\r\n\r\nFinal-Recipient: rfc822; another@example.com\r\nAction: failed\r\nStatus: 5.1.1`);expect(attributeSeparateDeliveryNotice(recipients,target)).toBeNull();
    const originals=fixture(); originals.payload!.parts!.push(originals.payload!.parts![2]);expect(attributeSeparateDeliveryNotice(originals,target)).toBeNull();
  });
  it("fails closed on missing bodies, oversized payload and excess parts", () => {
    const attachment=fixture();delete attachment.payload!.parts![1].body!.data;expect(attributeSeparateDeliveryNotice(attachment,target)).toBeNull();
    const large=fixture();large.payload!.parts![0].body!.data="a".repeat(65537);expect(attributeSeparateDeliveryNotice(large,target)).toBeNull();
    const many=fixture();many.payload!.parts!.push(...Array.from({length:40},()=>({mimeType:"text/plain"})));expect(attributeSeparateDeliveryNotice(many,target)).toBeNull();
  });
  it("rejects original-thread, sent, pre-send, and out-of-window messages", () => {
    expect(attributeSeparateDeliveryNotice({...fixture(),threadId:target.providerThreadId},target)).toBeNull();
    expect(attributeSeparateDeliveryNotice({...fixture(),labelIds:["SENT"]},target)).toBeNull();
    for(const date of ["2026-11-02T08:00:00Z","2026-12-05T08:00:00Z"]) expect(attributeSeparateDeliveryNotice({...fixture(),internalDate:String(Date.parse(date))},target)).toBeNull();
  });
});
