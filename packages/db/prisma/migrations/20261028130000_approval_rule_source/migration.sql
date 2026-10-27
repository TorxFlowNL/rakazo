-- Which rules the deployment keeps in sync itself (the TorxFlow read-only tool rules), apart
-- from the ones a member made. Additive: older releases never read or write it, and a null
-- source is a member's rule.
ALTER TABLE "action_approval_rules" ADD COLUMN "source" TEXT;
ALTER TABLE "user_action_approval_rules" ADD COLUMN "source" TEXT;
