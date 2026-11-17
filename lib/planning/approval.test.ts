import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approvalSettingsChanged,
  isOpenProposalStatus,
  proposalStatusLabel,
  proposalSubmissionBlock,
  type ApprovalSettingsValues,
} from "./approvals";

const disabledSettings: ApprovalSettingsValues = {
  enabled: false,
  finalApproverUserId: null,
  reviewerUserId: null,
};

test("submissions are refused until approvals are enabled and a final approver exists", () => {
  assert.equal(
    proposalSubmissionBlock({
      approvalsEnabled: false,
      finalApproverUserId: null,
      submitterUserId: 1,
      openProposal: false,
    }),
    "approvals_disabled",
  );
  assert.equal(
    proposalSubmissionBlock({
      approvalsEnabled: true,
      finalApproverUserId: null,
      submitterUserId: 1,
      openProposal: false,
    }),
    "approver_missing",
  );
});

test("an applicant can never be the final approver of their own submission", () => {
  assert.equal(
    proposalSubmissionBlock({
      approvalsEnabled: true,
      finalApproverUserId: 7,
      submitterUserId: 7,
      openProposal: false,
    }),
    "self_approval",
  );
  assert.equal(
    proposalSubmissionBlock({
      approvalsEnabled: true,
      finalApproverUserId: 8,
      submitterUserId: 7,
      openProposal: false,
    }),
    null,
  );
});

test("one unresolved proposal blocks another submission for the same quarter", () => {
  assert.equal(
    proposalSubmissionBlock({
      approvalsEnabled: true,
      finalApproverUserId: 8,
      submitterUserId: 7,
      openProposal: true,
    }),
    "open_proposal",
  );
});

test("material approval setting changes are detected while identical saves are no-ops", () => {
  const enabled: ApprovalSettingsValues = {
    enabled: true,
    finalApproverUserId: 8,
    reviewerUserId: 9,
  };
  assert.equal(approvalSettingsChanged(disabledSettings, disabledSettings), false);
  assert.equal(approvalSettingsChanged(enabled, { ...enabled }), false);
  assert.equal(approvalSettingsChanged(disabledSettings, enabled), true);
  assert.equal(approvalSettingsChanged(enabled, { ...enabled, enabled: false }), true);
  assert.equal(approvalSettingsChanged(enabled, { ...enabled, finalApproverUserId: 10 }), true);
  assert.equal(approvalSettingsChanged(enabled, { ...enabled, reviewerUserId: null }), true);
});

test("open proposal statuses and display labels stay explicit", () => {
  assert.equal(isOpenProposalStatus("submitted"), true);
  assert.equal(isOpenProposalStatus("under_review"), true);
  assert.equal(isOpenProposalStatus("returned"), false);
  assert.equal(isOpenProposalStatus("approved"), false);
  assert.equal(proposalStatusLabel("submitted"), "最終承認待ち");
  assert.equal(proposalStatusLabel("returned"), "差し戻し");
  assert.equal(proposalStatusLabel("approved"), "承認済み");
});
