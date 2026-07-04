// src/queues/queues.ts
import { Queue } from 'bullmq';
import redisConnection from '@/config/redis';
import { QueueName } from './names';

const connection = redisConnection;

export const payoutCronQueue = new Queue(QueueName.PAYOUT_CRON, { connection });
export const transfersQueue = new Queue(QueueName.TRANSFERS, { connection });