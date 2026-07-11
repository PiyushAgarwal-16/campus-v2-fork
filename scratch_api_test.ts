import { db } from './src/db/client.js';
import { wallService } from './src/services/wallService.js';
import { users } from './src/db/schema.js';
import { eq } from 'drizzle-orm';

async function run() {
  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, '9cea38c1-5f32-4ed0-9bc3-a33d526db934'))
    .limit(1);
  if (!user[0]) {
    console.log('User not found');
    process.exit(1);
  }
  const claims = {
    sub: user[0].id,
    email: user[0].email,
    role: user[0].role,
    universityId: user[0].universityId!,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  const feed = await wallService.feed(claims as any, { mode: 'latest', limit: 5 });
  console.log(
    'Feed Posts:',
    JSON.stringify(
      feed.posts.map((p) => ({ id: p.id, body: p.body, mediaIds: p.mediaIds })),
      null,
      2,
    ),
  );
  process.exit(0);
}
run().catch(console.error);
