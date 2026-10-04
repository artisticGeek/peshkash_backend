import { Request, Response } from 'express';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/sequelize';

type SharedCollectionRow = {
  id: string;
  name: string;
  notes: string | null;
  remarks: string | null;
  artworks: unknown;
  updated_at: string;
};

type SharedCollectionListRow = {
  id: string;
  token: string;
  name: string;
  notes: string | null;
  remarks: string | null;
  artwork_count: string | number;
  shared_at: string;
  updated_at: string;
};

export const PrintCollectionShareController = {
  list: async (req: Request, res: Response) => {
    const rows = await sequelize.query<SharedCollectionListRow>(
      `SELECT collection.id, share.token, collection.name, collection.notes, collection.remarks,
              CASE WHEN jsonb_typeof(share.artworks) = 'array'
                   THEN jsonb_array_length(share.artworks) ELSE 0 END AS artwork_count,
              share.created_at AS shared_at, collection.updated_at
         FROM print_collection_share share
         JOIN print_collections collection ON collection.id = share.collection_id
        WHERE share.phone = :phone
        ORDER BY share.created_at DESC, share.id DESC`,
      { replacements: { phone: req.user!.phone }, type: QueryTypes.SELECT },
    );
    return res.json(rows.map((row) => ({
      id: Number(row.id),
      token: row.token,
      path: `/print-collections/shared/${row.token}`,
      name: row.name,
      notes: row.notes,
      remarks: row.remarks,
      artworkCount: Number(row.artwork_count) || 0,
      sharedAt: row.shared_at,
      updatedAt: row.updated_at,
      readOnly: true,
    })));
  },

  get: async (req: Request, res: Response) => {
    const token = String(req.params.token || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
      return res.status(404).json({ error: 'Shared collection not found.' });
    }
    const rows = await sequelize.query<SharedCollectionRow>(
      `SELECT collection.id, collection.name, collection.notes, collection.remarks,
              share.artworks, collection.updated_at
         FROM print_collection_share share
         JOIN print_collections collection ON collection.id = share.collection_id
        WHERE share.token = :token AND (share.phone = :phone OR :isAdmin = true)
        LIMIT 1`,
      {
        replacements: { token, phone: req.user!.phone, isAdmin: req.user!.role === 'admin' },
        type: QueryTypes.SELECT,
      },
    );
    if (!rows.length) return res.status(404).json({ error: 'Shared collection not found for this phone number.' });
    const row = rows[0];
    return res.json({
      id: Number(row.id),
      name: row.name,
      notes: row.notes,
      remarks: row.remarks,
      artworks: row.artworks,
      updatedAt: row.updated_at,
      readOnly: true,
    });
  },
};
