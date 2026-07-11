import * as dotenv from 'dotenv';
dotenv.config({ path: 'apps/api/.env' });
import { db } from './apps/api/src/db/client.js';
import { wallPosts, postMedia } from './apps/api/src/db/schema.js';
import { desc, eq } from 'drizzle-orm';

async function run() {
  const posts = await db.select().from(wallPosts).orderBy(desc(wallPosts.createdAt)).limit(5);
  console.log('POSTS:', JSON.stringify(posts, null, 2));
  for (const p of posts) {
    const media = await db.select().from(postMedia).where(eq(postMedia.postId, p.id));
    console.log(`Media for post ${p.id}:`, media);
  }
  process.exit(0);
}
run().catch(console.error);
