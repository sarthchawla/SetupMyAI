---
name: organization-best-practices
description: This skill provides guidance and enforcement rules for implementing multi-tenant organizations, teams, and role-based access control using Better Auth's organization plugin.
---

## Setting Up Organizations

When adding organizations to your application, configure the `organization` plugin with appropriate limits and permissions.

```ts
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";

export const auth = betterAuth({
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      organizationLimit: 5, // Max orgs per user
      membershipLimit: 100, // Max members per org
    }),
  ],
});
```

**Note**: After adding the plugin, run `npx @better-auth/cli migrate` to add the required database tables.

### Client-Side Setup

Add the client plugin to access organization methods:

```ts
import { createAuthClient } from "better-auth/client";
import { organizationClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [organizationClient()],
});
```

## Creating Organizations

Organizations are the top-level entity for grouping users. When created, the creator is automatically assigned the `owner` role.

```ts
const createOrg = async () => {
  const { data, error } = await authClient.organization.create({
    name: "My Company",
    slug: "my-company",
    logo: "https://example.com/logo.png",
    metadata: { plan: "pro" },
  });
};
```

### Controlling Organization Creation

Restrict who can create organizations based on user attributes:

```ts
organization({
  allowUserToCreateOrganization: async (user) => {
    return user.emailVerified === true;
  },
  organizationLimit: async (user) => {
    return user.plan === "premium" ? 20 : 3;
  },
});
```

## Active Organizations

The active organization is stored in the session and scopes subsequent API calls. Always set an active organization after the user selects one.

```ts
const setActive = async (organizationId: string) => {
  const { data, error } = await authClient.organization.setActive({
    organizationId,
  });
};
```

## Members

Members are users who belong to an organization. Each member has a role that determines their permissions.

### Adding Members (Server-Side)

```ts
await auth.api.addMember({
  body: {
    userId: "user-id",
    role: "member",
    organizationId: "org-id",
  },
});
```

### Removing Members

```ts
await authClient.organization.removeMember({
  memberIdOrEmail: "user@example.com",
});
```

**Important**: The last owner cannot be removed. Assign the owner role to another member first.

## Invitations

The invitation system allows admins to invite users via email. Configure email sending to enable invitations.

```ts
organization({
  sendInvitationEmail: async (data) => {
    const { email, organization, inviter, invitation } = data;
    await sendEmail({
      to: email,
      subject: `Join ${organization.name}`,
      html: `<a href="https://yourapp.com/accept-invite?id=${invitation.id}">Accept</a>`,
    });
  },
});
```

## Roles & Permissions

The plugin provides role-based access control (RBAC) with three default roles:

| Role | Description |
|------|-------------|
| `owner` | Full access, can delete organization |
| `admin` | Can manage members, invitations, settings |
| `member` | Basic access to organization resources |

### Checking Permissions

```ts
const { data } = await authClient.organization.hasPermission({
  permission: "member:write",
});

if (data?.hasPermission) {
  // User can manage members
}
```

## Teams

Teams allow grouping members within an organization.

### Enabling Teams

```ts
organization({
  teams: {
    enabled: true,
  },
});
```

### Creating and Managing Teams

```ts
const { data } = await authClient.organization.createTeam({
  name: "Engineering",
});

await authClient.organization.addTeamMember({
  teamId: "team-id",
  userId: "user-id",
});
```

## Dynamic Access Control

For applications needing custom roles per organization at runtime:

```ts
organization({
  dynamicAccessControl: {
    enabled: true,
  },
});

await authClient.organization.createRole({
  role: "moderator",
  permission: {
    member: ["read"],
    invitation: ["read"],
  },
});
```

## Lifecycle Hooks

Execute custom logic at various points in the organization lifecycle:

```ts
organization({
  hooks: {
    organization: {
      afterCreate: async ({ organization, member }) => {
        await createDefaultResources(organization.id);
      },
    },
    member: {
      afterCreate: async ({ member, organization }) => {
        await notifyAdmins(organization.id, `New member joined`);
      },
    },
  },
});
```

## Schema Customization

Customize table names, field names, and add additional fields:

```ts
organization({
  schema: {
    organization: {
      modelName: "workspace",
      additionalFields: {
        billingId: { type: "string", required: false },
      },
    },
    member: {
      additionalFields: {
        department: { type: "string", required: false },
      },
    },
  },
});
```

## Security Considerations

### Owner Protection

- The last owner cannot be removed from an organization
- The last owner cannot leave the organization
- Always ensure ownership transfer before removing the current owner

### Organization Deletion

Deleting an organization removes all associated data. Prevent accidental deletion:

```ts
organization({
  disableOrganizationDeletion: true,
});
```

### Invitation Security

- Invitations expire after 48 hours by default
- Only the invited email address can accept an invitation
- Pending invitations can be cancelled by organization admins
