/**
 * One issue Linear says is still James'. Shared because the state file holds the
 * list and the poller produces it: a second definition in each would be two
 * shapes to keep in step.
 */
export interface LinearOpenIssue {
  /** The issue key, `ENG-1234`. The ledger's subject for anything about it. */
  identifier: string;
  title: string;
  url: string;
  /** The workflow state's own name, not its type: "In Review" says more than "started". */
  state: string;
  updatedAt: string;
}
