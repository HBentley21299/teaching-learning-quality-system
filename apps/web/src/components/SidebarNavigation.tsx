import { navigationGroups, navigationItems, type AppRoute } from "../app/navigation";

type NavigationItem = (typeof navigationItems)[number];

export function SidebarNavigation({ items, route, onNavigate }: {
  items: readonly NavigationItem[];
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
}) {
  function renderItem(item: NavigationItem) {
    const Icon = item.icon;
    return <button aria-current={item.key === route ? "page" : undefined}
      className={item.key === route ? "nav-item nav-item-active" : "nav-item"}
      key={item.key} onClick={() => onNavigate(item.key)} title={item.label} type="button">
      <Icon size={18} aria-hidden="true" /><span>{item.label}</span>
    </button>;
  }

  return <nav aria-label="i-Elevate areas" className="sidebar-navigation">
    <div className="sidebar-navigation-links">
      {items.filter(item => item.key === "home" || item.key === "dashboard").map(renderItem)}
    </div>
    {navigationGroups.map(group => {
      const groupItems = group.routes.flatMap(key => items.filter(item => item.key === key));
      if (!groupItems.length) return null;
      return <section aria-labelledby={`sidebar-${group.id}`} className="sidebar-navigation-group" key={group.id}>
        <h2 className="sidebar-navigation-heading" id={`sidebar-${group.id}`}>{group.title}</h2>
        <div className="sidebar-navigation-links">{groupItems.map(renderItem)}</div>
      </section>;
    })}
  </nav>;
}
