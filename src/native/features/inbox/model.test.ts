import { describe, expect, it } from 'vitest';
import type { MergeRequest } from '../../api/types';
import { buildGroups, clientKey, clientLabel, clientName, projectTitle } from './model';

/** `projectName` is the bare path until the backend caches the project, then GitLab's display name. */
const mr = (path: string, displayName?: string, id = 1) =>
  ({
    id,
    projectName: displayName ?? path,
    webUrl: `https://gitlab.example.com/${path}/-/merge_requests/${id}`,
    createdAt: id,
    updatedAt: id,
  }) as MergeRequest;

const utrecht = mr('customers/gemeente-utrecht/website', 'Customers / Gemeente Utrecht / Website Utrecht.nl');
const infra = mr('infrastructure/terraform/sst', 'Infrastructure and Platform Management / Terraform / SST');

describe('clientKey', () => {
  it('uses the group below customers, and the top-level group elsewhere', () => {
    expect(clientKey(utrecht)).toBe('customers/gemeente-utrecht');
    expect(clientKey(infra)).toBe('infrastructure');
    expect(clientKey(mr('templates/blocksmith-astro'))).toBe('templates');
  });

  it('keeps customers/redkiwi apart from the top-level redkiwi group', () => {
    expect(clientKey(mr('customers/redkiwi/gripp'))).not.toBe(clientKey(mr('redkiwi/gitlab/gitlab-api-rs')));
  });

  it('is the same whether or not the project name is cached', () => {
    expect(clientKey(mr('customers/gemeente-utrecht/website'))).toBe(clientKey(utrecht));
  });
});

describe('display names', () => {
  it("uses GitLab's names once cached", () => {
    expect(clientName(utrecht)).toBe('Gemeente Utrecht');
    expect(clientName(infra)).toBe('Infrastructure and Platform Management');
    expect(projectTitle(utrecht)).toBe('Website Utrecht.nl');
  });

  it('falls back to the path before the project is cached', () => {
    const bare = mr('customers/gemeente-utrecht/website');
    expect(clientName(bare)).toBe('Gemeente utrecht');
    expect(projectTitle(bare)).toBe('website');
  });

  it('labels a client key from any MR under it', () => {
    expect(clientLabel('customers/gemeente-utrecht', [infra, utrecht])).toBe('Gemeente Utrecht');
    expect(clientLabel('customers/gone', [utrecht])).toBe('Gone');
  });
});

describe('buildGroups', () => {
  it('leads project groups with the project and its client', () => {
    const [g] = buildGroups([utrecht], [], { group: 'project', sort: 'oldest' });
    expect(g).toMatchObject({ title: 'Website Utrecht.nl', detail: 'Gemeente Utrecht' });
  });

  it('groups clients by display name across projects', () => {
    const disc = mr('customers/normec/disc', 'Customers / Normec / DISC', 2);
    const site = mr('customers/normec/website', 'Customers / Normec / Normec Website', 3);
    const groups = buildGroups([disc, site, utrecht], [], { group: 'client', sort: 'oldest' });
    expect(groups.map((g) => g.title)).toEqual(['Gemeente Utrecht', 'Normec']);
    expect(groups[1]).toMatchObject({ detail: '2 projects', showProject: true });
  });
});
