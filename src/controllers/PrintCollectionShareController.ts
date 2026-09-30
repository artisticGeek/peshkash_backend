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

export const PrintCollectionShareController = {
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
