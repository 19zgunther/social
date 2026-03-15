I am working on building a mobile-first app (so tall and narrow by default).

General:
- Use no [id] routes - only use post request routes.
- Single page app - no different urls.
- Dark theme - use global color vars as much as possible, and define global color vars where needed
- Using prisma - do NOT use raw or unsafe queries EVER.
- Made for mobile - max width should be half the height, and min width should be 1/4 the height. Build the app within this
- Main content should always be full height with 0 padding at the top and bottom, and be as wide as the screen up to the limits defined above

Auth (Backend)
- Password base auth (Hash is stored in public.users.password_hash)
- We should mint our own token that's encrypted using the .env var TOKEN_ENCRYPTION_KEY, that when decrypted returns a JSON blob with the user_id, username, user_email, and minted_at timestamp
- All auth & encryption should be handled by auth_utils.ts
- We should not use middleware for auth. auth_utils.ts should export a function used in every other route for checking for & decrypting & validatating  the user token. This should return { user_id, username, email, minted_at, error }, and if 'error' is not undefined, we should console.error and return the error message/code.

Auth (Frontend)
- The App should start by checking if we're logged in or not (use api/auth-check)
- User should only see an Login/Signup page if not logged in

Pages:
- Feed (leftmost icon in bar), Groups

Navigation:
- Bottom navigation row/bar when on 'Feed', 'Groups'  (First icon in row, leftmost)

Feed Page:
- Should

Groups Page:
- Should open up to a list of threads the user has access to
- User should be able to create a new thread
- Tapping a thread list item should open the thread Thread page, replacing the list/groups page (but there should be a back button)
- Should have a loading indication while the threads load

Thread page:
- is a basic messanger where each person in the thread and view and send messages
- Should have a loading icon while the messages load
- Should load groups of 10 messages at a time (10 most recent)
- When you scroll up in the chat, it should auto-load older messages
- On the Thread Messages loading, the it should auto-scroll to the bottom instantly. 
- Whenever a new Thread Message is loaded (newest, at the bottom) 
    - If the user is currently scrolled to the bottom:
        - (if any scroll), they should scroll automatically and smoothly down to be at the new bottom showing the new message.
    - If user is not at the bottom
        - They should see a 'New Messages' button/icon pop up over the chat near the bottom. If they click it, they should auto-scroll to the bottom
- When a user sends a message:
    - They should auto-scroll to the bottom
- Sync system
   - Server should send notifications to all active users whenever a new message is posted in a thread they're in

Thread page settings
- Ability for the admin/owner of the thread to add or remove users
- Ability to name/rename the thread

Thread Message:
- Tap/Click & Hold for 1 second should bring up message options:
    - Edit message (If sender is current user)
    - Reply to message
- Replying to a message should use the parent_id.
- Replies should be loaded like other messages...
- Replied messages should be collapsed by default, but tapping 'replies' should expand them (should all be indented)


STORAGE:
- I setup a supabase storage bucket called 'main'. 
- Please add an app/api/server_file_storage_utils.ts and app/components/client_file_storage_utils.ts. I want to put all of the logic regarding file storage in these files.
- I want to be able to send photos in a thread

User Profile & Posts:
- At top of profile page, user should see their username and email. Below, they should see their posts.
- In a profile the user should see all of their 'posts' in a grid. 3 posts per row, as many rows as necessary. Grid full width, small 1px borders between posts.
- The first post cell (top-most left-most) should be a 'create post button'
- Posts should be ordered created_by top being the most recent to bottom oldest
- A post should consist of an image and an optional caption
- When a user tabs on a single post of theirs they should see just that post full-width with the caption and comments below, and not see anything else besides a back button. We'll call this the 'PostSection'

Feed
- In the feed the users should see full-width PostSections of their friends posts. 
- Only show posts to users by their friends...
- Show in order newest at top to oldest, and the user should be able to scroll down to see & load more posts.

PostSection
- Comments should be stored in the post.data: json blob.

Friends & Friending:
- In the profile section, users can search by username/email to request to follow other people. Other people in their profile section can approve/reject follow requests. Users only can see the feed/posts their freinds/accepted made. Note: if accepted, the the requesting_user should be able to see the other user's feed, and vice versa too. Also, you shouldn't be able to send a friend request to a user you're already friends with, or who has rejected your friend request. In general, for any 2 users, there should at most be 1 row in the friends table.

