import {redirect} from "next/navigation";

const GOOGLE_REVIEW_URL = "https://g.page/r/CWWqOp4BhgTkEAE/review";

export const metadata = {
  title: "Recenzie rezervare",
  description: "Redirectionare catre pagina de recenzii Google.",
};

export default function RecenziePage() {
  redirect(GOOGLE_REVIEW_URL);
}
