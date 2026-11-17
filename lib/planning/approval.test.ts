import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approvalSettingsChanged,
  effectiveProposalStatus,
  isOpenProposalStatus,
  proposalInitialReviewOutcome,
  proposalInitialStatus,
  proposalReviewOutcome,
  proposalReviewOutcomeLabel,
  proposalStatusAfterReview,
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
  assert.equal(isOpenProposalStatus("pending_decision"), true);
  assert.equal(isOpenProposalStatus("returned"), false);
  assert.equal(isOpenProposalStatus("approved"), false);
  assert.equal(proposalStatusLabel("under_review"), "レビュー待ち");
  assert.equal(proposalStatusLabel("pending_decision"), "最終承認待ち");
  assert.equal(proposalStatusLabel("returned"), "差し戻し");
  assert.equal(proposalStatusLabel("approved"), "承認済み");
});

test("review assignment chooses the review path while no reviewer goes straight to decision", () => {
  assert.equal(proposalInitialStatus(9), "under_review");
  assert.equal(proposalInitialReviewOutcome(9), null);
  assert.equal(proposalInitialStatus(null), "pending_decision");
  assert.equal(proposalInitialReviewOutcome(null), "not_required");
});

test("review outcomes keep pass and skipped paths explicit for the final decision", () => {
  assert.equal(proposalReviewOutcome("pass"), "passed");
  assert.equal(proposalStatusAfterReview("pass"), "pending_decision");
  assert.equal(proposalReviewOutcome("return"), "returned");
  assert.equal(proposalStatusAfterReview("return"), "returned");
  assert.equal(proposalReviewOutcomeLabel("passed"), "確認済み（決裁へ）");
  assert.equal(proposalReviewOutcomeLabel("not_required"), "レビュー不要");
});

test("legacy submitted rows follow their reviewer assignment without rewriting payload", () => {
  assert.equal(effectiveProposalStatus("submitted", 9), "under_review");
  assert.equal(effectiveProposalStatus("submitted", null), "pending_decision");
  assert.equal(effectiveProposalStatus("under_review", 9), "under_review");
  assert.equal(effectiveProposalStatus("returned", 9), "returned");
});
