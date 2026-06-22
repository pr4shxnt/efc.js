// Wraps mongoose connection for Pre-Flight. Throws clearly if mongoose isn't installed.

let mongoose: typeof import('mongoose');

async function loadMongoose(): Promise<typeof import('mongoose')> {
  if (mongoose) return mongoose;
  try {
    mongoose = await import('mongoose');
    return mongoose;
  } catch {
    throw new Error(
      '[EFC] mongoose is not installed. Run: npm install mongoose',
    );
  }
}

export async function connectMongo(url: string): Promise<import('mongoose').Connection> {
  const mg = await loadMongoose();
  await mg.connect(url);
  console.log('[EFC] MongoDB connected');
  return mg.connection;
}
