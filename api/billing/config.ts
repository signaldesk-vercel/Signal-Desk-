import type { VercelRequest, VercelResponse } from '@vercel/node';
export default function handler(req: VercelRequest,res: VercelResponse){if(req.method!=='POST')return res.status(405).json({message:'Method not allowed'});return res.status(200).json({configured:false,message:'Paddle billing route is reachable.'})}
