import GitHub from '@auth/core/providers/github';
import Google from '@auth/core/providers/google';
import { Anonymous } from '@convex-dev/auth/providers/Anonymous';
import { convexAuth } from '@convex-dev/auth/server';
import { internal } from './_generated/api';

const providers = [GitHub, Google] as const;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    ...providers,
    ...(process.env.ALLOW_ANONYMOUS_AUTH === '1' ? [Anonymous] : []),
  ],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx, { userId }) {
      await ctx.runMutation(internal.organizations.createPersonal, { userId });
    },
  },
});
