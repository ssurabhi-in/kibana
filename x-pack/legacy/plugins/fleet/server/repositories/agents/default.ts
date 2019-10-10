/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { isEqual } from 'lodash';
import { SavedObject } from 'src/core/server';
import {
  Agent,
  NewAgent,
  AgentsRepository as AgentsRepositoryType,
  SortOptions,
  SavedObjectAgentAttributes,
} from './types';
import { DEFAULT_AGENTS_PAGE_SIZE } from '../../../common/constants';
import { SODatabaseAdapter } from '../../adapters/saved_objects_database/adapter_types';
import { FrameworkUser } from '../../adapters/framework/adapter_types';

export class AgentsRepository implements AgentsRepositoryType {
  constructor(private readonly soAdapter: SODatabaseAdapter) {}

  /**
   * Create a new saved object agent
   * @param agent
   */
  public async create(
    user: FrameworkUser,
    agent: NewAgent,
    options?: { id?: string; overwrite?: boolean }
  ): Promise<Agent> {
    const so = await this.soAdapter.create(
      user,
      'agents',
      {
        ...agent,
        local_metadata: JSON.stringify(agent.local_metadata || {}),
        user_provided_metadata: JSON.stringify(agent.user_provided_metadata || {}),
        actions: [],
      },
      options
    );

    return this._savedObjectToAgent({
      ...so,
      attributes: {
        id: so.id,
        ...so.attributes,
      },
    });
  }

  /**
   * Delete an agent saved object
   * @param agent
   */
  public async delete(user: FrameworkUser, agent: Agent) {
    await this.soAdapter.delete(user, 'agents', agent.id);
  }

  /**
   * Get an agent by ES id
   * @param agent
   */
  public async getById(user: FrameworkUser, id: string): Promise<Agent | null> {
    const response = await this.soAdapter.get<SavedObjectAgentAttributes>(user, 'agents', id);
    if (!response) {
      return null;
    }

    return this._savedObjectToAgent(response);
  }

  /**
   * Get an agent by ES shared_id
   * @param agent
   */
  public async getBySharedId(user: FrameworkUser, sharedId: string): Promise<Agent | null> {
    const response = await this.soAdapter.find<SavedObjectAgentAttributes>(user, {
      type: 'agents',
      searchFields: ['shared_id'],
      search: sharedId,
    });

    const agents = response.saved_objects.map(this._savedObjectToAgent);

    if (agents.length > 0) {
      return agents[0];
    }

    return null;
  }

  /**
   * Update an agent
   *
   * @param id
   * @param newData
   */
  public async update(user: FrameworkUser, id: string, newData: Partial<Agent>) {
    const { local_metadata, user_provided_metadata, ...data } = newData;
    const updateData: Partial<SavedObjectAgentAttributes> = { ...data };

    if (newData.local_metadata) {
      updateData.local_metadata = JSON.stringify(newData.local_metadata);
    }
    if (updateData.user_provided_metadata) {
      updateData.user_provided_metadata = JSON.stringify(newData.user_provided_metadata);
    }

    const { error } = await this.soAdapter.update(user, 'agents', id, updateData);

    if (error) {
      throw new Error(error.message);
    }
  }

  /**
   * Find an agent by metadata
   * @param metadata
   * @param providedMetadata
   */
  public async findByMetadata(
    user: FrameworkUser,
    metadata: { local?: any; userProvided?: any }
  ): Promise<Agent[]> {
    const search = []
      .concat(Object.values(metadata.local || {}), Object.values(metadata.userProvided || {}))
      .join(' ');

    // neet to play with saved object to know what it's possible to do here
    const res = await this.soAdapter.find<SavedObjectAgentAttributes>(user, {
      type: 'agents',
      search,
    });

    return res.saved_objects.map(this._savedObjectToAgent).filter(agent => {
      return metadata.local
        ? isEqual(metadata.local, agent.local_metadata)
        : true && metadata.userProvided
        ? isEqual(metadata.userProvided, agent.user_provided_metadata)
        : true;
    });
  }

  /**
   * List agents
   */
  public async list(
    user: FrameworkUser,
    sortOptions?: SortOptions,
    page: number = 1,
    perPage: number = DEFAULT_AGENTS_PAGE_SIZE,
    kuery?: string
  ): Promise<{ agents: Agent[]; total: number; page: number; perPage: number }> {
    const { saved_objects, total } = await this.soAdapter.find<SavedObjectAgentAttributes>(user, {
      type: 'agents',
      page,
      perPage,
      filter: kuery && kuery !== '' ? kuery.replace(/agents\./g, 'agents.attributes.') : undefined,
      ...this._getSortFields(sortOptions),
    });

    const agents: Agent[] = saved_objects
      .map(this._savedObjectToAgent)
      .filter(agent => agent.type !== 'EPHEMERAL_INSTANCE');

    return {
      agents,
      total,
      page,
      perPage,
    };
  }

  public async findEphemeralByPolicySharedId(
    user: FrameworkUser,
    policySharedId: string
  ): Promise<Agent | null> {
    const res = await this.soAdapter.find<SavedObjectAgentAttributes>(user, {
      type: 'agents',
      search: policySharedId,
      searchFields: ['policy_shared_id'],
    });
    const agents = res.saved_objects
      .map(this._savedObjectToAgent)
      .filter(agent => agent.type === 'EPHEMERAL');

    return agents.length > 0 ? agents[0] : null;
  }

  /**
   * Get an agent by ephemeral access token
   * @param token
   */
  public async getByEphemeralAccessToken(user: FrameworkUser, token: any): Promise<Agent | null> {
    const res = await this.soAdapter.find<SavedObjectAgentAttributes>(user, {
      type: 'agents',
      search: token,
      searchFields: ['access_token'],
    });

    const agents = res.saved_objects.map(this._savedObjectToAgent);

    if (agents.length < 0) {
      return null;
    }

    return agents[0];
  }
  private _savedObjectToAgent(so: SavedObject<SavedObjectAgentAttributes>): Agent {
    if (so.error) {
      throw new Error(so.error.message);
    }

    return {
      id: so.id,
      ...so.attributes,
      local_metadata: JSON.parse(so.attributes.local_metadata),
      user_provided_metadata: JSON.parse(so.attributes.user_provided_metadata),
    };
  }

  private _getSortFields(sortOption?: SortOptions) {
    switch (sortOption) {
      case SortOptions.EnrolledAtASC:
        return {
          sortField: 'enrolled_at',
          sortOrder: 'ASC',
        };
      case SortOptions.EnrolledAtDESC:
        return {
          sortField: 'enrolled_at',
          sortOrder: 'DESC',
        };
      default:
        return {};
    }
  }
}
