/**
 * Rules for `thread_messages.root_parent_id` (efficient one-query section/thread subtrees):
 * - Thread top-level: `parent_id = threadId`, `root_parent_id = null`
 * - Reply in normal thread: if parent is a top-level (parent.parent_id === threadId), new `root_parent_id = parent.id`;
 *   else inherit `parent.root_parent_id ?? parent.id`
 * - Post section root: `parent_id = threadId` (group), has `post_id`, `root_parent_id = null`
 * - Reply under a post section: if parent is the section root, `root_parent_id = sectionRootId` (= parent_id);
 *   else `parent.root_parent_id ?? sectionRootId`
 */
export const computeThreadReplyRootParentId = (
  threadId: string,
  parentMessage: { id: string; parent_id: string | null; root_parent_id: string | null },
): string | null => {
  if (!parentMessage.parent_id) {
    return null;
  }
  if (parentMessage.parent_id === threadId) {
    return parentMessage.id;
  }
  return parentMessage.root_parent_id ?? parentMessage.id;
};

export const computePostSectionReplyRootParentId = (
  sectionRootId: string,
  parentMessage: { id: string; parent_id: string | null; root_parent_id: string | null },
): string => {
  if (parentMessage.id === sectionRootId) {
    return sectionRootId;
  }
  return parentMessage.root_parent_id ?? sectionRootId;
};
