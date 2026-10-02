export default function handler(req: any, res: any) { res.status(200).json({ data: { publishableKey: process.env.CLERK_PUBLISHABLE_KEY || "" } }); }
