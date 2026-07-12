Goal: Change how Posting & Friends works
- Users should make posts to specific 'groups', 'all', or 'permanent'
    - Each groups is a subset of their friends. These are not the threads/groups system - new construct.
    - If they select 'all', that means all current friends should be able to see the post.
    - If they select 'permanent', then all current and future friends should be able to see the post. This is essentially then the same as how post visibility work right now, where if you friend someone, you can see their posts. Permanent posts should NOT go in the user_post_access table... permanent posts have column 'permanent' set to TRUE
- If you are friends with someone, you should only be able to see the posts they sent to you.
- People who view your profile will only see the posts you made and sent to them.
- Users should be able to create/define 'groups'.
    - These groups are subsets of their friends
    - They are private to the user
    - They can be named, people can be added, people can be removed
    - These mappings should be stored in the user's table 'post_groups_data' column
- Post visibility should be stored in a table with 3 columns: post_id, created_at, viewer_id (userID of users who can see it)
    - Needs to be indexed such that it's a quick lookup to get the last posts and filter by most-recent
    - See 'user_post_access' table

- Creating Groups:
    - User should be able to configure groups of people.
    - Need a 'Groups' tab to be added to the Profile tab where users can edit each group.
    - A user can put a friend into 0 or more groups.


model user_post_access {
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  post_id    String   @db.Uuid
  viewer_id  String   @db.Uuid
  created_at DateTime @db.Timestamptz(6)
  posts      posts    @relation(fields: [post_id], references: [id], onDelete: NoAction, onUpdate: NoAction)
  users      users    @relation(fields: [viewer_id], references: [id], onDelete: NoAction, onUpdate: NoAction)
}