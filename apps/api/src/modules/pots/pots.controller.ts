import { FastifyReply, FastifyRequest } from "fastify";
import { PotsService } from "./pots.service";
import { PotMembersService } from "./pot-members.service";
import { assertIsAdmin, getViewablePotOrThrow } from "./pot-authorization";
import { PotError } from "./pots.errors";
import {
  AddMemberInput,
  CreatePotInput,
  MemberParams,
  PotIdParams,
  UpdateMemberRoleInput,
  UpdatePotInput,
} from "./pots.schema";

function handlePotError(e: unknown, reply: FastifyReply) {
  if (e instanceof PotError) {
    return reply.code(e.statusCode).send({ message: e.message });
  }
  console.log(e);
  return reply.code(500).send({ message: "Something went wrong" });
}

// request.user's type claims it's always present (see jwt.ts's FastifyJWT
// augmentation), but that's only true behind the hard `server.authenticate`
// preHandler. Routes here use `optionalAuthenticate` instead, which can
// leave it genuinely undefined at runtime for an anonymous caller — the
// `?.` below is load-bearing, not defensive noise, despite what the type
// implies.
function currentUserId(request: FastifyRequest): string | undefined {
  return request.user?.sub;
}

function requireUserId(request: FastifyRequest): string {
  const userId = currentUserId(request);
  if (!userId) {
    throw new PotError("Authentication required", 401);
  }
  return userId;
}

export async function createPotHandler(
  request: FastifyRequest<{ Body: CreatePotInput }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    const pot = await PotsService.create(userId, request.body);
    return reply.code(201).send(pot);
  } catch (e) {
    return handlePotError(e, reply);
  }
}

export async function listPotsHandler(request: FastifyRequest, reply: FastifyReply) {
  try {
    const pots = await PotsService.list(currentUserId(request));
    return reply.code(200).send(pots);
  } catch (e) {
    return handlePotError(e, reply);
  }
}

export async function getPotHandler(
  request: FastifyRequest<{ Params: PotIdParams }>,
  reply: FastifyReply
) {
  try {
    const pot = await getViewablePotOrThrow(request.params.id, currentUserId(request));
    return reply.code(200).send(pot);
  } catch (e) {
    return handlePotError(e, reply);
  }
}

export async function updatePotHandler(
  request: FastifyRequest<{ Params: PotIdParams; Body: UpdatePotInput }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    const pot = await PotsService.update(request.params.id, userId, request.body);
    return reply.code(200).send(pot);
  } catch (e) {
    return handlePotError(e, reply);
  }
}

export async function activatePotHandler(
  request: FastifyRequest<{ Params: PotIdParams }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    const pot = await PotsService.activate(request.params.id, userId);
    return reply.code(200).send(pot);
  } catch (e) {
    return handlePotError(e, reply);
  }
}

export async function closePotHandler(
  request: FastifyRequest<{ Params: PotIdParams }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    const pot = await PotsService.close(request.params.id, userId);
    return reply.code(200).send(pot);
  } catch (e) {
    return handlePotError(e, reply);
  }
}

export async function triggerPayoutHandler(
  request: FastifyRequest<{ Params: PotIdParams }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    const result = await PotsService.triggerPayout(request.params.id, userId);
    return reply.code(200).send(result);
  } catch (e) {
    return handlePotError(e, reply);
  }
}

export async function triggerRefundHandler(
  request: FastifyRequest<{ Params: PotIdParams }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    const result = await PotsService.triggerRefund(request.params.id, userId);
    return reply.code(200).send(result);
  } catch (e) {
    return handlePotError(e, reply);
  }
}

export async function listMembersHandler(
  request: FastifyRequest<{ Params: PotIdParams }>,
  reply: FastifyReply
) {
  try {
    // Visibility rule applies to membership listing too — reuses the same
    // 404-on-private-non-member check as viewing the pot itself.
    await getViewablePotOrThrow(request.params.id, currentUserId(request));
    const members = await PotMembersService.list(request.params.id);
    return reply.code(200).send(members);
  } catch (e) {
    return handlePotError(e, reply);
  }
}

export async function addMemberHandler(
  request: FastifyRequest<{ Params: PotIdParams; Body: AddMemberInput }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    await assertIsAdmin(request.params.id, userId);
    const member = await PotMembersService.add(request.params.id, userId, request.body);
    return reply.code(201).send(member);
  } catch (e) {
    return handlePotError(e, reply);
  }
}

export async function updateMemberRoleHandler(
  request: FastifyRequest<{ Params: MemberParams; Body: UpdateMemberRoleInput }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    await assertIsAdmin(request.params.id, userId);
    const member = await PotMembersService.updateRole(
      request.params.id,
      request.params.userId,
      request.body
    );
    return reply.code(200).send(member);
  } catch (e) {
    return handlePotError(e, reply);
  }
}

export async function removeMemberHandler(
  request: FastifyRequest<{ Params: MemberParams }>,
  reply: FastifyReply
) {
  try {
    const userId = requireUserId(request);
    await assertIsAdmin(request.params.id, userId);
    await PotMembersService.remove(request.params.id, request.params.userId);
    return reply.code(200).send({ message: "Member removed" });
  } catch (e) {
    return handlePotError(e, reply);
  }
}
