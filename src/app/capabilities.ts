import {
  CloudUpload,
  FileText,
  Grid2X2,
  Home,
  type LucideIcon,
  Settings,
} from 'lucide-react';

export interface BuiltinCapability {
  id: 'home' | 'markdown' | 'files' | 'tools';
  name: string;
  shortName: string;
  description: string;
  icon: LucideIcon;
}

export const MAX_POPUP_CAPABILITIES = 3;

export const BUILTIN_CAPABILITIES: BuiltinCapability[] = [
  {
    id: 'home',
    name: '首页',
    shortName: '首页',
    description: '最近文档与常用操作',
    icon: Home,
  },
  {
    id: 'markdown',
    name: 'Markdown 工作区',
    shortName: '文档',
    description: '阅读、编辑与多格式输出',
    icon: FileText,
  },
  {
    id: 'files',
    name: '文件与分享',
    shortName: '文件',
    description: '上传、文件库与链接分享',
    icon: CloudUpload,
  },
  {
    id: 'tools',
    name: '我的工具',
    shortName: '工具',
    description: '整理常用网页工具',
    icon: Grid2X2,
  },
];

export const SETTINGS_CAPABILITY = {
  id: 'settings' as const,
  name: '设置',
  icon: Settings,
};
