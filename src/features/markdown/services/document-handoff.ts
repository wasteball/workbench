interface DocumentHandoff {
  documentId: string;
  title: string;
  content: string;
}

const handoffs = new Map<string, DocumentHandoff>();

export const documentHandoff = {
  put(value: DocumentHandoff): void {
    handoffs.set(value.documentId, value);
  },

  take(documentId: string): DocumentHandoff | undefined {
    const value = handoffs.get(documentId);
    handoffs.delete(documentId);
    return value;
  },
};
