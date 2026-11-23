import type { Notification, RejectionReason } from "./api";

// TEMPLATE. All texts for errors and alerts are here, and they are placeholders.
// Later, they will follow the guides of large companies (see "Error and alert messages" in README.md).
// To change a text, change it here only. The code and the pages do not need to change.

const MESSAGES: Record<string, string> = {
  // Network and session
  network_error: "Sem conexão. Tente de novo.",
  missing_token: "Entre na sua conta para continuar.",
  invalid_token: "Sua sessão expirou. Entre de novo.",
  not_registered: "Crie seu perfil para continuar.",
  sign_in_failed: "Não foi possível entrar.",
  profile_load_failed: "Não foi possível carregar seu perfil.",
  unknown_error: "Algo deu errado.",

  // Registration
  invalid_username: "Nome de usuário não válido.",
  blocked_username: "Esse nome não pode ser usado.",
  username_taken: "Esse nome já está em uso.",
  already_registered: "Esta conta já tem cadastro.",
  consent_required: "Aceite o termo para continuar.",
  busy_retry: "O servidor está ocupado. Tente de novo.",

  // Recording (the server codes and the checks on the device)
  low_pose_rate: "O corpo não apareceu o bastante.",
  low_any_hand_rate: "As mãos não apareceram o bastante.",
  few_frames: "O aparelho processou poucos quadros.",
  low_quality: "Gravação não aceita.",
  low_framing: "Os ombros e pelo menos um braço precisam aparecer durante o sinal.",
  framing_shoulders: "Mostre os dois ombros.",
  framing_arms: "Mostre pelo menos um braço, do cotovelo à mão.",
  sign_complete: "Todas as repetições deste sinal já foram gravadas.",
  unknown_sign: "Sinal não disponível.",
  upload_in_progress: "O envio anterior ainda está em andamento.",
  recording_not_found: "Gravação não encontrada.",
  recording_file_missing: "O arquivo da gravação não está mais disponível.",
  cannot_review_own: "Você não pode revisar as suas próprias gravações.",
  invalid_status: "Status não válido.",
  storage_error: "Não foi possível guardar a gravação.",
  camera_error: "Não foi possível ligar a câmera.",

  // Administration
  admin_only: "Só administradores podem fazer isso.",
  reviewer_only: "Só revisores podem fazer isso.",
  slug_taken: "Já existe um sinal com esse nome.",
  invalid_sign: "Sinal não válido.",
  sign_not_found: "Sinal não encontrado.",
};

/** Text for a code. For a code that is not in the list, show the code, so the problem is easy to report. */
export function messageFor(code: string): string {
  return MESSAGES[code] ?? `Erro: ${code}`;
}

/** Text for each reason that a reviewer can give when a recording is rejected. */
export const REJECTION_REASON_TEXT: Record<RejectionReason, string> = {
  wrong_sign: "Sinal errado",
  hands_not_visible: "As mãos não aparecem",
  body_not_visible: "Corpo fora do enquadramento",
  incomplete_motion: "Movimento incompleto",
  other: "Outro motivo",
};

/** Title for the banner and the bell, and the reason (if any) for the list of the bell. */
export function notificationText(item: Notification): { title: string; detail?: string } {
  const name = item.sign_name ?? "um sinal";
  if (item.type === "recording_accepted") return { title: `Sua gravação de ${name} foi aceita` };
  return {
    title: `Sua gravação de ${name} foi rejeitada`,
    detail: item.reason ? `Motivo: ${REJECTION_REASON_TEXT[item.reason]}` : undefined,
  };
}
