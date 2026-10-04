/** Salas do Socket.IO. Só o servidor decide quem entra em salas de equipe e de usuário. */
export const rooms = {
  restaurant: (establishmentId: string) => `restaurant:${establishmentId}`,
  staff: (establishmentId: string) => `staff:${establishmentId}`,
  user: (userId: string) => `user:${userId}`,
};
