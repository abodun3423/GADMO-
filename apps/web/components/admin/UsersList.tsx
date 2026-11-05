'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { localPhone } from '@/lib/format';
import type { AdminUserRow } from '@/lib/types';
import { AdminNav } from './AdminNav';
import { ACCOUNT_STATUS_LABEL, CHECK_LABEL, dateTime, ROLE_LABEL } from './labels';
import { StaffOnly } from './StaffOnly';

export function UsersList() {
  return (
    <StaffOnly next="/admin/users">
      <Users />
    </StaffOnly>
  );
}

function Users() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const role = params.get('role') ?? '';
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? '1') || 1;

  const [search, setSearch] = useState(q);
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams();
    if (q) query.set('q', q);
    if (role) query.set('role', role);
    if (status) query.set('status', status);
    if (page > 1) query.set('page', String(page));
    setRows(null);
    api<{ users: AdminUserRow[]; hasMore: boolean }>(`/v1/admin/users?${query}`)
      .then((r) => {
        setRows(r.users);
        setHasMore(r.hasMore);
      })
      .catch(() => setError('Accounts could not be loaded. Check your connection and refresh.'));
  }, [q, role, status, page]);

  function go(next: Record<string, string>) {
    const query = new URLSearchParams({ q, role, status, ...next });
    for (const [k, v] of [...query.entries()])
      if (!v || (k === 'page' && v === '1')) query.delete(k);
    router.push(`/admin/users${query.size ? `?${query}` : ''}`);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    go({ q: search.trim(), page: '1' });
  }

  return (
    <>
      <AdminNav />
      <h1 className="page-title">Users</h1>

      <form className="filters" onSubmit={submit} role="search">
        <div className="field">
          <label htmlFor="user-search">Name, phone or email</label>
          <input
            id="user-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="e.g. Tunde or 0803 123 4567"
          />
        </div>
        <div className="field">
          <label htmlFor="role">Type</label>
          <select id="role" value={role} onChange={(e) => go({ role: e.target.value, page: '1' })}>
            <option value="">All</option>
            <option value="CUSTOMER">Customers</option>
            <option value="PRO">Pros</option>
            <option value="ADMIN">Staff</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="status">Status</label>
          <select
            id="status"
            value={status}
            onChange={(e) => go({ status: e.target.value, page: '1' })}
          >
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="BANNED">Banned</option>
          </select>
        </div>
        <button className="button button-small" type="submit">
          Search
        </button>
      </form>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {rows === null && !error && <p className="meta">Loading…</p>}
      {rows?.length === 0 && <p className="empty">No accounts match.</p>}

      <ul className="review-list">
        {rows?.map((u) => (
          <li key={u.id}>
            <Link href={`/admin/users/${u.id}`} className="review-item">
              <span className="review-name">{u.name ?? 'No name yet'}</span>
              <span className="meta">
                {ROLE_LABEL[u.role]} · {localPhone(u.phone)} · joined{' '}
                {dateTime.format(new Date(u.createdAt))}
              </span>
              <span className="tags">
                {u.status !== 'ACTIVE' && (
                  <span className="badge badge-alert">{ACCOUNT_STATUS_LABEL[u.status]}</span>
                )}
                {u.role === 'PRO' && u.verificationStatus && (
                  <span className="badge badge-plain">{CHECK_LABEL[u.verificationStatus]}</span>
                )}
                {u.isOnline && <span className="badge badge-ok">Online</span>}
                {u.chatFlags > 0 && (
                  <span className="badge badge-alert">
                    {u.chatFlags} contact-sharing {u.chatFlags === 1 ? 'attempt' : 'attempts'}
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="pager">
        {page > 1 && (
          <button
            className="button button-quiet button-small"
            type="button"
            onClick={() => go({ page: String(page - 1) })}
          >
            Previous
          </button>
        )}
        {hasMore && (
          <button
            className="button button-quiet button-small"
            type="button"
            onClick={() => go({ page: String(page + 1) })}
          >
            Next
          </button>
        )}
      </div>
    </>
  );
}
