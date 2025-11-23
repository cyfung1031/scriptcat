import type { ReactNode } from "react";
import React from "react";
import "./index.css";

const PopupLayout: React.FC<{
  children: ReactNode;
}> = ({ children }) => {
  return <div className="popup-layout">{children}</div>;
};

export default PopupLayout;
